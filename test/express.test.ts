import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { joinPaths, parseExpressFile } from '../src/scanner/express';

const routesOf = (source: string): string[] =>
  parseExpressFile('server.js', source).routes.map((route) => `${route.method} ${route.path}`);

test('joinPaths normalises slashes', () => {
  assert.equal(joinPaths('', ''), '/');
  assert.equal(joinPaths('', '/health'), '/health');
  assert.equal(joinPaths('/api/users', '/'), '/api/users');
  assert.equal(joinPaths('/api/', '/users/'), '/api/users');
  assert.equal(joinPaths('api', 'users'), '/api/users');
});

test('finds routes on app and router instances', () => {
  const source = `
    const express = require('express');
    const app = express();
    const admin = express.Router();
    app.get('/health', handler);
    app.post('/login', validate, handler);
    admin.delete('/users/:id', handler);
  `;
  assert.deepEqual(routesOf(source), ['GET /health', 'POST /login', 'DELETE /users/:id']);
});

test('reports the line of each route', () => {
  const source = ["import express from 'express';", 'const app = express();', '', "app.get('/a', handler);"].join('\n');
  assert.deepEqual(parseExpressFile('server.ts', source).routes, [{ method: 'GET', path: '/a', line: 3 }]);
});

test('ignores settings getters and calls on unrelated objects', () => {
  const source = `
    const express = require('express');
    const app = express();
    app.get('port');
    axios.get('/users', options);
    cache.delete('/key', now);
  `;
  assert.deepEqual(routesOf(source), []);
});

test('applies prefixes from routers mounted in the same file', () => {
  const source = `
    import express, { Router } from 'express';
    const app = express();
    const api = Router();
    const users = Router();
    app.use('/api', api);
    api.use('/users', users);
    users.get('/:id', handler);
    api.get('/status', handler);
  `;
  assert.deepEqual(routesOf(source), ['GET /api/users/:id', 'GET /api/status']);
});

test('expands route() chains and arrays of paths', () => {
  const source = `
    const router = require('express').Router();
    router.route('/orders').get(list).post(create);
    router.get(['/a', '/b'], handler);
  `;
  assert.deepEqual(routesOf(source).sort(), ['GET /a', 'GET /b', 'GET /orders', 'POST /orders']);
});

test('returns mounts of routers imported from other files', () => {
  const source = `
    import express from 'express';
    import cors from 'cors';
    import usersRouter from './routes/users';
    const app = express();
    app.use(cors);
    app.use('/api/users', usersRouter);
    app.use('/api', require('./routes/orders'));
  `;
  assert.deepEqual(parseExpressFile('server.ts', source).mounts, [
    { prefix: '/api/users', specifier: './routes/users' },
    { prefix: '/api', specifier: './routes/orders' },
  ]);
});
