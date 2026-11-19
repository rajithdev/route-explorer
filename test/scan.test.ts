import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { scanRoutes } from '../src/scanner';

// Compiled tests run from out/test, so the fixtures are two levels up.
const EXAMPLES = path.resolve(__dirname, '..', '..', 'examples');

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

const scan = (dir: string) =>
  scanRoutes({ files: listFiles(dir), readFile: (file) => fs.readFileSync(file, 'utf8') });

test('scans the example Next.js app', () => {
  const routes = scan(path.join(EXAMPLES, 'next-app'));
  assert.deepEqual(
    routes.map((route) => `${route.method} ${route.path}`),
    [
      'PAGE /',
      'PAGE /about',
      'ALL /api/health',
      'GET /api/users',
      'POST /api/users',
      'GET /api/users/[id]',
      'DELETE /api/users/[id]',
      'PAGE /blog/[slug]',
    ],
  );
  assert.ok(routes.every((route) => route.framework === 'next'));
});

test('scans the example Express app and resolves routers mounted across files', () => {
  const routes = scan(path.join(EXAMPLES, 'express-app'));
  assert.deepEqual(
    routes.map((route) => `${route.method} ${route.path}`),
    [
      'GET /api/orders',
      'POST /api/orders',
      'DELETE /api/orders/:id',
      'GET /api/users',
      'POST /api/users',
      'GET /api/users/:id',
      'GET /health',
    ],
  );

  const deleteOrder = routes.find((route) => route.method === 'DELETE');
  assert.equal(path.basename(deleteOrder?.file ?? ''), 'orders.js');
  assert.equal(deleteOrder?.line, 9);
});

test('does not report Next.js routes without a next dependency', () => {
  const routes = scanRoutes({
    files: ['/repo/package.json', '/repo/src/pages/Home.tsx', '/repo/app/page.tsx'],
    readFile: (file) => (file.endsWith('package.json') ? '{"dependencies":{"react":"^19.0.0"}}' : ''),
  });
  assert.deepEqual(routes, []);
});
