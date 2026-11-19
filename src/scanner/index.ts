import * as path from 'node:path';
import { ExpressFileResult, joinPaths, parseExpressFile } from './express';
import { appRouterPath, exportedHttpMethods, pagesRouterPath } from './next';
import { Framework, Route } from './types';

export interface ScanInput {
  /** Absolute paths of the workspace's source files and package.json files. */
  files: string[];
  /** Returns a file's text, or undefined if it cannot be read. */
  readFile(file: string): string | undefined;
}

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const FRAMEWORK_ORDER: Framework[] = ['next', 'express'];
const METHOD_ORDER = ['PAGE', 'ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const toPosix = (file: string): string => file.replace(/\\/g, '/');
const isSource = (file: string): boolean => SOURCE_EXT.test(file) && !file.endsWith('.d.ts');

/** Scans a workspace file list and returns every route found, sorted for display. */
export function scanRoutes(input: ScanInput): Route[] {
  const routes = [...scanNext(input), ...scanExpress(input)];
  return routes.sort(
    (a, b) =>
      FRAMEWORK_ORDER.indexOf(a.framework) - FRAMEWORK_ORDER.indexOf(b.framework) ||
      a.path.localeCompare(b.path) ||
      METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method),
  );
}

/** Directories whose package.json depends on `next`, deepest first. */
function findNextRoots(input: ScanInput): string[] {
  const roots: string[] = [];
  for (const file of input.files) {
    if (path.basename(file) !== 'package.json') {
      continue;
    }
    try {
      const manifest = JSON.parse(input.readFile(file) ?? '');
      if (manifest.dependencies?.next || manifest.devDependencies?.next) {
        roots.push(toPosix(path.dirname(file)));
      }
    } catch {
      // unreadable or invalid package.json: not a Next.js root
    }
  }
  return roots.sort((a, b) => b.length - a.length);
}

function scanNext(input: ScanInput): Route[] {
  const roots = findNextRoots(input);
  const routes: Route[] = [];
  if (roots.length === 0) {
    return routes;
  }

  for (const file of input.files) {
    const posixFile = toPosix(file);
    const root = roots.find((candidate) => posixFile.startsWith(`${candidate}/`));
    if (!root || !isSource(posixFile)) {
      continue;
    }
    const relative = posixFile.slice(root.length + 1).replace(/^src\//, '');

    if (relative.startsWith('app/')) {
      const hit = appRouterPath(relative.slice('app/'.length));
      if (hit?.kind === 'page') {
        routes.push({ framework: 'next', kind: 'page', method: 'PAGE', path: hit.path, file, line: 0 });
      } else if (hit) {
        const text = input.readFile(file);
        for (const exported of text === undefined ? [] : exportedHttpMethods(posixFile, text)) {
          routes.push({ framework: 'next', kind: 'api', method: exported.method, path: hit.path, file, line: exported.line });
        }
      }
    } else if (relative.startsWith('pages/')) {
      const hit = pagesRouterPath(relative.slice('pages/'.length));
      if (hit) {
        const method = hit.kind === 'api' ? 'ALL' : 'PAGE';
        routes.push({ framework: 'next', kind: hit.kind, method, path: hit.path, file, line: 0 });
      }
    }
  }
  return routes;
}

function resolveModule(fromFile: string, specifier: string, known: ReadonlySet<string>): string | undefined {
  const base = path.posix.join(path.posix.dirname(fromFile), specifier);
  // `./users.js` in TypeScript ESM code refers to `./users.ts` on disk.
  for (const stem of [base, base.replace(/\.(js|mjs|cjs)$/, '')]) {
    const candidates = [
      stem,
      ...RESOLVE_EXTS.map((ext) => stem + ext),
      ...RESOLVE_EXTS.map((ext) => `${stem}/index${ext}`),
    ];
    const match = candidates.find((candidate) => known.has(candidate));
    if (match) {
      return match;
    }
  }
  return undefined;
}

function scanExpress(input: ScanInput): Route[] {
  const originalPath = new Map<string, string>();
  const parsed = new Map<string, ExpressFileResult>();

  for (const file of input.files) {
    const posixFile = toPosix(file);
    if (!isSource(posixFile)) {
      continue;
    }
    const text = input.readFile(file);
    if (!text || !text.includes('express')) {
      continue;
    }
    const result = parseExpressFile(posixFile, text);
    if (result.routes.length > 0 || result.mounts.length > 0) {
      parsed.set(posixFile, result);
      originalPath.set(posixFile, file);
    }
  }

  // target file -> the files that mount it, and under which prefix
  const mountedBy = new Map<string, { from: string; prefix: string }[]>();
  const known = new Set(parsed.keys());
  for (const [file, result] of parsed) {
    for (const mount of result.mounts) {
      const target = resolveModule(file, mount.specifier, known);
      if (target) {
        mountedBy.set(target, [...(mountedBy.get(target) ?? []), { from: file, prefix: mount.prefix }]);
      }
    }
  }

  const prefixesOf = (file: string, seen: ReadonlySet<string>): string[] => {
    const parents = mountedBy.get(file);
    if (!parents || seen.has(file)) {
      return [''];
    }
    const next = new Set(seen).add(file);
    return parents.flatMap((mount) => prefixesOf(mount.from, next).map((prefix) => joinPaths(prefix, mount.prefix)));
  };

  const routes: Route[] = [];
  const emitted = new Set<string>();
  for (const [file, result] of parsed) {
    for (const prefix of prefixesOf(file, new Set())) {
      for (const route of result.routes) {
        const fullPath = joinPaths(prefix, route.path);
        const key = `${route.method} ${fullPath} ${file}:${route.line}`;
        if (!emitted.has(key)) {
          emitted.add(key);
          routes.push({
            framework: 'express',
            kind: 'api',
            method: route.method,
            path: fullPath,
            file: originalPath.get(file) ?? file,
            line: route.line,
          });
        }
      }
    }
  }
  return routes;
}

export type { Route } from './types';
