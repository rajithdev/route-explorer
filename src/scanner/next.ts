import * as ts from 'typescript';
import { RouteKind } from './types';

const SOURCE_EXT = /\.(tsx|ts|jsx|js|mjs)$/;
const ROUTE_HANDLER_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const PAGES_SPECIAL_FILES = new Set(['_app', '_document', '_error']);

export interface NextRouteHit {
  path: string;
  kind: RouteKind;
}

export interface ExportedMethod {
  method: string;
  line: number;
}

/**
 * Maps a file inside an App Router `app/` directory to its URL path.
 * `relPath` is relative to `app/` and uses forward slashes, e.g. `(shop)/cart/page.tsx`.
 * Returns undefined for files that do not define a route.
 */
export function appRouterPath(relPath: string): NextRouteHit | undefined {
  const segments = relPath.split('/');
  const fileName = segments.pop() ?? '';
  if (!SOURCE_EXT.test(fileName)) {
    return undefined;
  }
  const base = fileName.replace(SOURCE_EXT, '');
  if (base !== 'page' && base !== 'route') {
    return undefined;
  }

  const urlSegments: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith('_')) {
      return undefined; // private folder: opted out of routing
    }
    if (/^\(\.{1,3}\)/.test(segment)) {
      return undefined; // intercepting route: renders at another route's URL
    }
    if (segment.startsWith('@') || /^\(.*\)$/.test(segment)) {
      continue; // parallel-route slot or route group: not part of the URL
    }
    urlSegments.push(segment);
  }
  return { path: `/${urlSegments.join('/')}`, kind: base === 'page' ? 'page' : 'api' };
}

/**
 * Maps a file inside a Pages Router `pages/` directory to its URL path.
 * `relPath` is relative to `pages/` and uses forward slashes, e.g. `api/health.ts`.
 */
export function pagesRouterPath(relPath: string): NextRouteHit | undefined {
  if (!SOURCE_EXT.test(relPath) || relPath.endsWith('.d.ts')) {
    return undefined;
  }
  const segments = relPath.replace(SOURCE_EXT, '').split('/');
  const last = segments[segments.length - 1];
  if (PAGES_SPECIAL_FILES.has(last)) {
    return undefined;
  }
  if (last === 'index') {
    segments.pop();
  }
  return { path: `/${segments.join('/')}`, kind: relPath.startsWith('api/') ? 'api' : 'page' };
}

/** Finds the HTTP methods a `route.ts` file exports, with the line of each export. */
export function exportedHttpMethods(fileName: string, text: string): ExportedMethod[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: ExportedMethod[] = [];
  const add = (name: ts.Node, text: string): void => {
    if (ROUTE_HANDLER_METHODS.has(text)) {
      found.push({ method: text, line: sf.getLineAndCharacterOfPosition(name.getStart(sf)).line });
    }
  };
  const isExported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && isExported(statement)) {
      add(statement.name, statement.name.text);
    } else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          add(declaration.name, declaration.name.text);
        }
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        add(element.name, element.name.text);
      }
    }
  }
  return found;
}
