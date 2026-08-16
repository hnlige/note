import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTH_TOKEN_RENEWAL_GRACE_SECONDS,
  DEFAULT_TOKEN_TTL_SECONDS,
  LEGACY_TOKEN_MIGRATION_DEADLINE_SECONDS,
  LEGACY_TOKEN_TTL_SECONDS,
  createAuthToken,
  getAuthTokenSecret,
  parseAuthToken,
  parseAuthTokenSession,
} from './auth.session';

test('createAuthToken and parseAuthToken round-trip a user identity', () => {
  const token = createAuthToken({
    id: '6',
    username: 'dingmin',
    name: '丁敏',
    role: 'OWNER',
    roleId: 'r3',
    roleIds: null,
    deptId: null,
    orgId: null,
  });

  assert.ok(token);
  assert.deepEqual(parseAuthToken(token), {
    id: '6',
    username: 'dingmin',
    name: '丁敏',
    role: 'OWNER',
    roleId: 'r3',
    roleIds: null,
    deptId: null,
    orgId: null,
  });
});

test('createAuthToken embeds an expiration timestamp', () => {
  const token = createAuthToken({
    id: '6',
    username: 'dingmin',
    name: '丁敏',
    role: 'OWNER',
    roleId: 'r3',
  });
  const [payload] = token.split('.');
  const parsedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

  assert.equal(typeof parsedPayload.exp, 'number');
  assert.ok(parsedPayload.exp > Math.floor(Date.now() / 1000));
  assert.equal(parsedPayload.exp - parsedPayload.iat, DEFAULT_TOKEN_TTL_SECONDS);
});

test('parseAuthToken returns null for an expired token', () => {
  const token = createAuthToken(
    {
      id: '6',
      username: 'dingmin',
      name: '丁敏',
      role: 'OWNER',
      roleId: 'r3',
    },
    { expiresInSeconds: -1 },
  );

  assert.equal(parseAuthToken(token), null);
});

test('parseAuthTokenSession accepts a signed expired token inside the renewal window', () => {
  const now = Math.floor(Date.now() / 1000);
  const token = createAuthToken(
    {
      id: '6',
      username: 'dingmin',
      name: '丁敏',
      role: 'OWNER',
      roleId: 'r3',
    },
    { expiresInSeconds: -1 },
  );

  const session = parseAuthTokenSession(token, now);
  assert.equal(session?.user.id, '6');
  assert.equal(session?.expired, true);
  assert.equal(session?.shouldRenew, true);
});

test('parseAuthTokenSession migrates an old 8-hour token before the migration deadline', () => {
  const originalNow = Date.now;
  const now = LEGACY_TOKEN_MIGRATION_DEADLINE_SECONDS - 1;
  const issuedAt = now - 10 * 24 * 60 * 60;
  try {
    Date.now = () => issuedAt * 1000;
    const token = createAuthToken(
      {
        id: '49ffe612-b15a-4afc-ac4f-b46e015ae22a',
        username: '00000210',
        name: '吴艺悦',
        role: '督办专员',
        roleId: 'r2',
      },
      { expiresInSeconds: LEGACY_TOKEN_TTL_SECONDS },
    );

    const session = parseAuthTokenSession(token, now);
    assert.equal(session?.user.name, '吴艺悦');
    assert.equal(session?.expired, true);
    assert.equal(session?.shouldRenew, true);
  } finally {
    Date.now = originalNow;
  }
});

test('parseAuthTokenSession rejects an old 8-hour token after the migration deadline', () => {
  const originalNow = Date.now;
  const issuedAt = LEGACY_TOKEN_MIGRATION_DEADLINE_SECONDS - 10 * 24 * 60 * 60;
  try {
    Date.now = () => issuedAt * 1000;
    const token = createAuthToken(
      {
        id: '49ffe612-b15a-4afc-ac4f-b46e015ae22a',
        username: '00000210',
        name: '吴艺悦',
        role: '督办专员',
        roleId: 'r2',
      },
      { expiresInSeconds: LEGACY_TOKEN_TTL_SECONDS },
    );

    assert.equal(parseAuthTokenSession(token, LEGACY_TOKEN_MIGRATION_DEADLINE_SECONDS), null);
  } finally {
    Date.now = originalNow;
  }
});

test('parseAuthTokenSession rejects an expired token beyond the renewal window', () => {
  const originalNow = Date.now;
  const now = Math.floor(originalNow() / 1000);
  const issuedAt = now - AUTH_TOKEN_RENEWAL_GRACE_SECONDS - 60;
  try {
    Date.now = () => issuedAt * 1000;
    const token = createAuthToken(
      {
        id: '6',
        username: 'dingmin',
        name: '丁敏',
        role: 'OWNER',
        roleId: 'r3',
      },
      { expiresInSeconds: -1 },
    );

    assert.equal(parseAuthTokenSession(token, now), null);
  } finally {
    Date.now = originalNow;
  }
});

test('parseAuthToken returns null for an empty token', () => {
  assert.equal(parseAuthToken(''), null);
});

test('parseAuthToken returns null for a tampered token', () => {
  const token = createAuthToken({
    id: '6',
    username: 'dingmin',
    name: '丁敏',
    role: 'OWNER',
    roleId: 'r3',
  });

  assert.equal(parseAuthToken(`${token}tampered`), null);
});

test('getAuthTokenSecret requires an explicit secret in production', () => {
  assert.throws(
    () => getAuthTokenSecret({ NODE_ENV: 'production' }),
    /AUTH_TOKEN_SECRET/,
  );
  assert.equal(getAuthTokenSecret({ NODE_ENV: 'development' }), 'duban-dev-auth-secret');
  assert.equal(getAuthTokenSecret({ NODE_ENV: 'production', AUTH_TOKEN_SECRET: 'configured-secret' }), 'configured-secret');
});
