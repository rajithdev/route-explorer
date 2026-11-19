import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { test } from 'node:test';
import {
  buildUrl,
  describeFailure,
  fillPath,
  formatResponse,
  isLocalUrl,
  pathParams,
  sendRequest,
} from '../src/request';

const next = (path: string) => ({ framework: 'next' as const, path });
const express = (path: string) => ({ framework: 'express' as const, path });

test('pathParams: Next.js dynamic, catch-all and optional catch-all segments', () => {
  assert.deepEqual(pathParams(next('/about')), []);
  assert.deepEqual(pathParams(next('/blog/[slug]/comments/[id]')), [
    { token: '[slug]', name: 'slug', optional: false, catchAll: false },
    { token: '[id]', name: 'id', optional: false, catchAll: false },
  ]);
  assert.deepEqual(pathParams(next('/docs/[...path]')), [
    { token: '[...path]', name: 'path', optional: false, catchAll: true },
  ]);
  assert.deepEqual(pathParams(next('/shop/[[...filters]]')), [
    { token: '[[...filters]]', name: 'filters', optional: true, catchAll: true },
  ]);
});

test('pathParams: Express named, constrained, optional and wildcard segments', () => {
  assert.deepEqual(pathParams(express('/users/:userId/posts/:postId')).map((param) => param.name), ['userId', 'postId']);
  assert.deepEqual(pathParams(express('/users/:id(\\d+)')), [
    { token: ':id(\\d+)', name: 'id', optional: false, catchAll: false },
  ]);
  assert.deepEqual(pathParams(express('/users/:id?')), [
    { token: ':id?', name: 'id', optional: true, catchAll: false },
  ]);
  assert.deepEqual(pathParams(express('/files/*')), [
    { token: '*', name: 'wildcard', optional: false, catchAll: true },
  ]);
  assert.deepEqual(pathParams(express('/files/*rest')).map((param) => param.name), ['rest']);
});

test('fillPath: substitutes and encodes values', () => {
  assert.equal(fillPath(express('/users/:id'), { id: '42' }), '/users/42');
  assert.equal(fillPath(express('/users/:id(\\d+)/posts'), { id: '7' }), '/users/7/posts');
  assert.equal(fillPath(next('/blog/[slug]'), { slug: 'hello world/again' }), '/blog/hello%20world%2Fagain');
  assert.equal(fillPath(next('/docs/[...path]'), { path: 'guides/getting started' }), '/docs/guides/getting%20started');
  assert.equal(fillPath(next('/'), {}), '/');
});

test('fillPath: optional segments may be left out, required ones may not', () => {
  assert.equal(fillPath(next('/shop/[[...filters]]'), {}), '/shop');
  assert.equal(fillPath(express('/users/:id?'), { id: '' }), '/users');
  assert.throws(() => fillPath(express('/users/:id'), {}), /Missing value for :id/);
});

test('buildUrl: joins base URL and path, rejects invalid bases', () => {
  assert.equal(buildUrl('http://localhost:3000', '/api/users'), 'http://localhost:3000/api/users');
  assert.equal(buildUrl(' http://localhost:3000/ ', '/'), 'http://localhost:3000/');
  assert.equal(buildUrl('https://example.com/v1/', '/users'), 'https://example.com/v1/users');
  assert.throws(() => buildUrl('localhost:3000', '/'));
  assert.throws(() => buildUrl('not a url', '/'));
});

test('isLocalUrl: recognises this machine only', () => {
  assert.equal(isLocalUrl('http://localhost:3000/a'), true);
  assert.equal(isLocalUrl('http://127.0.0.1:8080/a'), true);
  assert.equal(isLocalUrl('http://[::1]:8080/a'), true);
  assert.equal(isLocalUrl('http://app.localhost/a'), true);
  assert.equal(isLocalUrl('https://api.example.com/a'), false);
  assert.equal(isLocalUrl('http://localhost.example.com/a'), false);
});

test('formatResponse: pretty-prints JSON and marks empty bodies', () => {
  const request = { method: 'GET', url: 'http://localhost:3000/api/users' };
  const text = formatResponse(request, {
    status: 200,
    statusText: 'OK',
    headers: [['content-type', 'application/json; charset=utf-8']],
    body: '{"id":1}',
    durationMs: 12.4,
  });
  assert.equal(
    text,
    [
      'GET http://localhost:3000/api/users',
      '200 OK in 12 ms',
      '',
      'content-type: application/json; charset=utf-8',
      '',
      '{',
      '  "id": 1',
      '}',
    ].join('\n'),
  );

  const empty = formatResponse(request, { status: 204, statusText: 'No Content', headers: [], body: '', durationMs: 3 });
  assert.ok(empty.endsWith('(empty body)'));
});

test('sendRequest: talks to a real local server', async (t) => {
  const seen: { method?: string; url?: string; contentType?: string; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, contentType: req.headers['content-type'], body });
      if (req.url === '/old') {
        res.writeHead(302, { location: '/new' }).end();
      } else {
        res.writeHead(req.method === 'POST' ? 201 : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const got = await sendRequest({ method: 'GET', url: `${base}/api/users/42` });
  assert.equal(got.status, 200);
  assert.equal(got.body, '{"ok":true}');
  assert.ok(got.headers.some(([name, value]) => name === 'content-type' && value === 'application/json'));

  const posted = await sendRequest({ method: 'POST', url: `${base}/api/users`, body: '{"name":"Ada"}' });
  assert.equal(posted.status, 201);

  const redirected = await sendRequest({ method: 'GET', url: `${base}/old` });
  assert.equal(redirected.status, 302);

  assert.deepEqual(seen, [
    { method: 'GET', url: '/api/users/42', contentType: undefined, body: '' },
    { method: 'POST', url: '/api/users', contentType: 'application/json', body: '{"name":"Ada"}' },
    { method: 'GET', url: '/old', contentType: undefined, body: '' },
  ]);
});

test('describeFailure: explains a refused connection', async (t) => {
  // Find a port with nothing listening by opening and closing a server on it.
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));

  const url = `http://127.0.0.1:${port}/health`;
  await assert.rejects(sendRequest({ method: 'GET', url, timeoutMs: 2000 }), (error) => {
    assert.equal(
      describeFailure(error, url),
      `Nothing is listening at http://127.0.0.1:${port}. Start your server or change the base URL.`,
    );
    return true;
  });
  void t;
});
