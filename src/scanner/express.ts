import * as ts from 'typescript';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']);

export interface LocalRoute {
  method: string;
  /** Path with every prefix known inside this file already applied. */
  path: string;
  line: number;
}

export interface FileMount {
  /** Prefix under which another module's router is mounted. */
  prefix: string;
  /** Relative import specifier of that module, e.g. `./routes/users`. */
  specifier: string;
}

export interface ExpressFileResult {
  routes: LocalRoute[];
  mounts: FileMount[];
}

/** Joins URL path parts into one normalised path: leading slash, no doubled or trailing slashes. */
export function joinPaths(...parts: string[]): string {
  const joined = parts.join('/').replace(/\/+/g, '/').replace(/\/$/, '');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

/** Reads a path argument: a string, a plain template literal, or an array of those. */
function stringValues(node: ts.Expression | undefined): string[] | undefined {
  if (!node) {
    return undefined;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }
  if (ts.isArrayLiteralExpression(node)) {
    const values = node.elements.flatMap((element) => stringValues(element) ?? []);
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}

function requireSpecifier(node: ts.Expression): string | undefined {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
    const arg = node.arguments[0];
    if (arg && ts.isStringLiteral(arg)) {
      return arg.text;
    }
  }
  return undefined;
}

/** True for `express()`, `Router()`, `express.Router()` and `require('express').Router()`. */
function createsRouter(initializer: ts.Expression): boolean {
  if (!ts.isCallExpression(initializer)) {
    return false;
  }
  const callee = initializer.expression;
  if (ts.isIdentifier(callee)) {
    return callee.text === 'express' || callee.text === 'Router';
  }
  return ts.isPropertyAccessExpression(callee) && callee.name.text === 'Router';
}

/**
 * Extracts the routes one file declares and the routers it mounts from other files.
 * Mounts between routers declared in the same file are resolved here; mounts of
 * imported routers are returned for the workspace scan to resolve.
 */
export function parseExpressFile(fileName: string, text: string): ExpressFileResult {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const routers = new Set<string>();
  const imports = new Map<string, string>();

  const collect = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause) {
      const specifier = node.moduleSpecifier.text;
      const { name, namedBindings } = node.importClause;
      if (name) {
        imports.set(name.text, specifier);
      }
      if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        imports.set(namedBindings.name.text, specifier);
      } else if (namedBindings) {
        for (const element of namedBindings.elements) {
          imports.set(element.name.text, specifier);
        }
      }
    } else if (ts.isVariableDeclaration(node) && node.initializer) {
      const specifier = requireSpecifier(node.initializer);
      if (specifier && ts.isIdentifier(node.name)) {
        imports.set(node.name.text, specifier);
      } else if (specifier && ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (ts.isIdentifier(element.name)) {
            imports.set(element.name.text, specifier);
          }
        }
      } else if (ts.isIdentifier(node.name) && createsRouter(node.initializer)) {
        routers.add(node.name.text);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);

  const rawRoutes: { router: string; method: string; path: string; line: number }[] = [];
  const localMounts: { parent: string; child: string; prefix: string }[] = [];
  const rawFileMounts: { router: string; prefix: string; specifier: string }[] = [];
  const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;

  /** Resolves `router.route('/x').get(a).post(b)` chains back to their router and path. */
  const routeChain = (expression: ts.Expression): { router: string; paths: string[] } | undefined => {
    let current = expression;
    while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
      const name = current.expression.name.text;
      const inner = current.expression.expression;
      if (name === 'route' && ts.isIdentifier(inner) && routers.has(inner.text)) {
        const paths = stringValues(current.arguments[0]);
        return paths ? { router: inner.text, paths } : undefined;
      }
      if (!HTTP_METHODS.has(name)) {
        return undefined;
      }
      current = inner;
    }
    return undefined;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      const target = node.expression.expression;

      if (name === 'use' && ts.isIdentifier(target) && routers.has(target.text)) {
        const prefixes = stringValues(node.arguments[0]);
        const handlers: readonly ts.Expression[] = prefixes ? node.arguments.slice(1) : node.arguments;
        for (const prefix of prefixes ?? ['']) {
          for (const handler of handlers) {
            if (ts.isIdentifier(handler) && routers.has(handler.text)) {
              localMounts.push({ parent: target.text, child: handler.text, prefix });
              continue;
            }
            const specifier = ts.isIdentifier(handler) ? imports.get(handler.text) : requireSpecifier(handler);
            if (specifier?.startsWith('.')) {
              rawFileMounts.push({ router: target.text, prefix, specifier });
            }
          }
        }
      } else if (HTTP_METHODS.has(name)) {
        const method = name.toUpperCase();
        const line = lineOf(node.expression.name);
        // `app.get('name')` with one argument reads a setting, so a route needs a handler too.
        if (ts.isIdentifier(target) && routers.has(target.text) && node.arguments.length >= 2) {
          for (const path of stringValues(node.arguments[0]) ?? []) {
            rawRoutes.push({ router: target.text, method, path, line });
          }
        } else {
          const chain = routeChain(target);
          for (const path of chain?.paths ?? []) {
            rawRoutes.push({ router: chain!.router, method, path, line });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  /** Every prefix a router is reachable under through `parent.use(prefix, child)` in this file. */
  const prefixesOf = (router: string, seen: ReadonlySet<string>): string[] => {
    const parents = localMounts.filter((mount) => mount.child === router);
    if (parents.length === 0 || seen.has(router)) {
      return [''];
    }
    const next = new Set(seen).add(router);
    return parents.flatMap((mount) => prefixesOf(mount.parent, next).map((prefix) => joinPaths(prefix, mount.prefix)));
  };

  const none: ReadonlySet<string> = new Set();
  return {
    routes: rawRoutes.flatMap((route) =>
      prefixesOf(route.router, none).map((prefix) => ({
        method: route.method,
        path: joinPaths(prefix, route.path),
        line: route.line,
      })),
    ),
    mounts: rawFileMounts.flatMap((mount) =>
      prefixesOf(mount.router, none).map((prefix) => ({
        prefix: joinPaths(prefix, mount.prefix),
        specifier: mount.specifier,
      })),
    ),
  };
}
