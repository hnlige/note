import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthToken } from './auth.session';
import { RENEWED_AUTH_TOKEN_HEADER, getRequestUserFromAuthHeader, requireAuth } from './auth.middleware';

test('getRequestUserFromAuthHeader returns null when auth header is missing', () => {
  assert.equal(getRequestUserFromAuthHeader(undefined), null);
});

test('getRequestUserFromAuthHeader returns null for a malformed auth header', () => {
  assert.equal(getRequestUserFromAuthHeader('Basic xxx'), null);
});

test('getRequestUserFromAuthHeader returns the parsed user for a bearer token', () => {
  const token = createAuthToken({
    id: '1',
    username: 'admin',
    name: '张管理',
    role: 'ADMIN',
    roleId: 'r1',
    roleIds: null,
    deptId: null,
    orgId: null,
  });

  assert.deepEqual(getRequestUserFromAuthHeader(`Bearer ${token}`), {
    id: '1',
    username: 'admin',
    name: '张管理',
    role: 'ADMIN',
    roleId: 'r1',
    roleIds: null,
    deptId: null,
    orgId: null,
  });
});

test('requireAuth renews a signed expired token inside the renewal window', () => {
  const token = createAuthToken(
    {
      id: '1',
      username: 'admin',
      name: '张管理',
      role: 'ADMIN',
      roleId: 'r1',
      roleIds: null,
      deptId: null,
      orgId: null,
    },
    { expiresInSeconds: -1 },
  );
  const headers: Record<string, string> = {};
  const req = { headers: { authorization: `Bearer ${token}` } } as never;

  requireAuth(req, {
    setHeader(name: string, value: string) { headers[name] = value; return this; },
    status() { throw new Error('renewable token should not be rejected'); },
    json() { return this; },
  } as never, () => {});

  assert.equal((req as { authUser?: { id?: string } }).authUser?.id, '1');
  assert.equal(typeof headers[RENEWED_AUTH_TOKEN_HEADER], 'string');
  assert.notEqual(headers[RENEWED_AUTH_TOKEN_HEADER], token);
});
