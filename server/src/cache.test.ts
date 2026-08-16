import test from 'node:test';
import assert from 'node:assert/strict';

import { cacheMiddleware, invalidateAll } from './cache';

function createResponse() {
  const headers: Record<string, string> = {};
  return {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    headers,
  };
}

test('cacheMiddleware scopes GET cache by authenticated user id', () => {
  invalidateAll();
  const middleware = cacheMiddleware('roles', 60_000);
  const reqA = { method: 'GET', originalUrl: '/api/roles', authUser: { id: 'user-a' } };
  const reqB = { method: 'GET', originalUrl: '/api/roles', authUser: { id: 'user-b' } };

  const resA1 = createResponse();
  middleware(reqA, resA1, () => resA1.json([{ id: 'r6' }]));
  assert.deepEqual(resA1.body, [{ id: 'r6' }]);
  assert.equal(resA1.headers['X-Cache'], 'MISS');

  const resB1 = createResponse();
  middleware(reqB, resB1, () => resB1.json([{ id: 'r2' }]));
  assert.deepEqual(resB1.body, [{ id: 'r2' }]);
  assert.equal(resB1.headers['X-Cache'], 'MISS');

  const resA2 = createResponse();
  middleware(reqA, resA2, () => resA2.json([{ id: 'wrong' }]));
  assert.deepEqual(resA2.body, [{ id: 'r6' }]);
  assert.equal(resA2.headers['X-Cache'], 'HIT');

  const resB2 = createResponse();
  middleware(reqB, resB2, () => resB2.json([{ id: 'wrong' }]));
  assert.deepEqual(resB2.body, [{ id: 'r2' }]);
  assert.equal(resB2.headers['X-Cache'], 'HIT');
});
