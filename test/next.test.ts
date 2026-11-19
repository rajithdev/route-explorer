import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { appRouterPath, exportedHttpMethods, pagesRouterPath } from '../src/scanner/next';

test('app router: maps page and route files to URL paths', () => {
  assert.deepEqual(appRouterPath('page.tsx'), { path: '/', kind: 'page' });
  assert.deepEqual(appRouterPath('blog/[slug]/page.tsx'), { path: '/blog/[slug]', kind: 'page' });
  assert.deepEqual(appRouterPath('docs/[[...path]]/page.jsx'), { path: '/docs/[[...path]]', kind: 'page' });
  assert.deepEqual(appRouterPath('api/users/route.ts'), { path: '/api/users', kind: 'api' });
});

test('app router: route groups and parallel slots are not part of the URL', () => {
  assert.deepEqual(appRouterPath('(marketing)/about/page.tsx'), { path: '/about', kind: 'page' });
  assert.deepEqual(appRouterPath('(shop)/(checkout)/cart/page.tsx'), { path: '/cart', kind: 'page' });
  assert.deepEqual(appRouterPath('dashboard/@analytics/page.tsx'), { path: '/dashboard', kind: 'page' });
});

test('app router: ignores files that do not define a route', () => {
  assert.equal(appRouterPath('layout.tsx'), undefined);
  assert.equal(appRouterPath('blog/page.test.tsx'), undefined);
  assert.equal(appRouterPath('_components/page.tsx'), undefined);
  assert.equal(appRouterPath('feed/(..)photo/[id]/page.tsx'), undefined);
  assert.equal(appRouterPath('blog/page.css'), undefined);
});

test('pages router: maps files to URL paths', () => {
  assert.deepEqual(pagesRouterPath('index.tsx'), { path: '/', kind: 'page' });
  assert.deepEqual(pagesRouterPath('blog/index.tsx'), { path: '/blog', kind: 'page' });
  assert.deepEqual(pagesRouterPath('posts/[id].tsx'), { path: '/posts/[id]', kind: 'page' });
  assert.deepEqual(pagesRouterPath('api/health.ts'), { path: '/api/health', kind: 'api' });
  assert.equal(pagesRouterPath('_app.tsx'), undefined);
  assert.equal(pagesRouterPath('_document.tsx'), undefined);
});

test('route handlers: finds exported HTTP methods and their lines', () => {
  const source = [
    'export async function GET() {}',
    'export const POST = async () => {};',
    'const remove = async () => {};',
    'export { remove as DELETE };',
    'export function helper() {}',
    'function PUT() {}',
  ].join('\n');

  assert.deepEqual(exportedHttpMethods('route.ts', source), [
    { method: 'GET', line: 0 },
    { method: 'POST', line: 1 },
    { method: 'DELETE', line: 3 },
  ]);
});
