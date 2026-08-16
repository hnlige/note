import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';

import {
  buildRoleInsertValues,
  detectProtectedAdminPrivilegeChange,
  getAllowedActionsUpdate,
  getRoleWriteAffectedRows,
  normalizeRoleResponse,
  parseAllowedPageActions,
  rolesRouter,
} from './roles';

const FAIL_CLOSED_ALLOWED_ACTIONS = ['__INVALID_ALLOWED_ACTIONS__'];

async function requestRoleRoute(method: 'POST' | 'PUT', route: string, allowedActions: unknown) {
  const app = express();
  app.use(express.json());
  app.use('/roles', rolesRouter);

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    return await fetch(`http://127.0.0.1:${port}/roles${route}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试角色', allowedActions }),
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('getRoleWriteAffectedRows reads affected rows from mysql2 update results', () => {
  assert.equal(getRoleWriteAffectedRows({ affectedRows: 1 }), 1);
  assert.equal(getRoleWriteAffectedRows([{ affectedRows: 2 }]), 2);
});

test('getRoleWriteAffectedRows treats missing update result as unknown', () => {
  assert.equal(getRoleWriteAffectedRows(undefined), null);
  assert.equal(getRoleWriteAffectedRows({}), null);
});

test('buildRoleInsertValues sets createdAt explicitly for strict mysql schemas', () => {
  const createdAt = new Date('2026-07-30T08:00:00.000Z');

  const values = buildRoleInsertValues({
    id: 'role-new',
    name: '督办管理员',
    permissions: ['MENU_WORKBENCH'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
    orgIds: [],
  }, 'role-new', createdAt);

  assert.equal(values.createdAt, createdAt);
});

test('buildRoleInsertValues preserves page action grants', () => {
  const values = buildRoleInsertValues({
    id: 'role-page',
    name: '页面动作角色',
    permissions: ['MENU_ITEMS'],
    dataScope: 'SELF',
    allowedActions: ['READ', 'SEARCH'],
    allowedPageActions: { MENU_ITEMS: ['EXPORT'] },
  }, 'role-page', new Date('2026-08-07T00:00:00.000Z'));

  assert.deepEqual(values.allowedActions, ['READ', 'SEARCH']);
  assert.deepEqual(values.allowedPageActions, { MENU_ITEMS: ['EXPORT'] });
});

test('role writes accept only arrays or JSON arrays of non-empty strings', () => {
  const validValues = [
    { input: [], expected: [] },
    { input: ['READ', 'SEARCH'], expected: ['READ', 'SEARCH'] },
    { input: '[]', expected: [] },
    { input: '["READ","SEARCH"]', expected: ['READ', 'SEARCH'] },
  ];

  for (const { input, expected } of validValues) {
    const values = buildRoleInsertValues({
      name: '合法角色',
      allowedActions: input,
    }, 'role-valid');
    assert.deepEqual(values.allowedActions, expected);
  }

  const malformedValues = ['{bad json}', 'READ', { action: 'READ' }, 7, ['READ', 7], ['READ', '']];
  for (const allowedActions of malformedValues) {
    assert.throws(
      () => buildRoleInsertValues({ name: '非法角色', allowedActions }, 'role-invalid'),
      /allowedActions must be an array of non-empty strings/i,
      `accepted malformed allowedActions: ${JSON.stringify(allowedActions)}`,
    );
  }
});

test('role write defaults remain compatible and PUT omission preserves existing allowedActions', () => {
  assert.deepEqual(
    buildRoleInsertValues({ name: '默认角色' }, 'role-default').allowedActions,
    [],
  );
  assert.deepEqual(getAllowedActionsUpdate({}), {});
  assert.deepEqual(getAllowedActionsUpdate({ allowedActions: [] }), { allowedActions: [] });
});

test('GET normalization keeps valid unrestricted arrays but fails closed for malformed stored actions', () => {
  assert.deepEqual(normalizeRoleResponse({ id: 'valid-empty', allowedActions: [] }).allowedActions, []);
  assert.deepEqual(normalizeRoleResponse({ id: 'valid-json-empty', allowedActions: '[]' }).allowedActions, []);

  for (const allowedActions of ['{bad json}', 'READ', { action: 'READ' }, 7, ['READ', 7], null]) {
    assert.deepEqual(
      normalizeRoleResponse({ id: 'legacy-malformed', allowedActions }).allowedActions,
      FAIL_CLOSED_ALLOWED_ACTIONS,
      `normalized malformed stored actions as unrestricted: ${JSON.stringify(allowedActions)}`,
    );
  }
});

test('POST and PUT reject malformed allowedActions with HTTP 400 before database access', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = '';

  try {
    for (const methodAndRoute of [
      ['POST', '/'] as const,
      ['PUT', '/role-existing'] as const,
    ]) {
      const [method, route] = methodAndRoute;
      for (const allowedActions of ['{bad json}', 'READ', { action: 'READ' }, 7, ['READ', 7]]) {
        const response = await requestRoleRoute(method, route, allowedActions);
        assert.equal(
          response.status,
          400,
          `${methodAndRoute[0]} accepted malformed allowedActions: ${JSON.stringify(allowedActions)}`,
        );
      }
    }
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('parseAllowedPageActions recursively parses a top-level JSON string object', () => {
  const pageActions = { MENU_ITEMS: ['EXPORT'] };

  assert.deepEqual(parseAllowedPageActions(JSON.stringify(pageActions)), pageActions);
  assert.deepEqual(parseAllowedPageActions(JSON.stringify(JSON.stringify(pageActions))), pageActions);
});

test('parseAllowedPageActions rejects non-object and array top-level values', () => {
  assert.deepEqual(parseAllowedPageActions(null), {});
  assert.deepEqual(parseAllowedPageActions('false'), {});
  assert.deepEqual(parseAllowedPageActions('["EXPORT"]'), {});
});

test('parseAllowedPageActions drops page values that are not arrays', () => {
  assert.deepEqual(parseAllowedPageActions({
    MENU_ITEMS: 'EXPORT',
    MENU_STATISTICS: ['EXPORT', '', 42],
  }), {
    MENU_STATISTICS: ['EXPORT'],
  });
});

test('parseAllowedPageActions drops empty page arrays', () => {
  assert.deepEqual(parseAllowedPageActions({
    MENU_ITEMS: [],
    MENU_STATISTICS: ['', 42],
  }), {});
});

test('built-in admin role rejects every authorization downgrade while ordinary metadata remains editable', () => {
  const existingAdmin = {
    id: 'r1',
    authCodes: ['ALL'],
    permissions: ['ALL'],
    dataScope: 'ALL',
    followerDataScope: 'ALL',
    allowedActions: ['READ', 'SEARCH', 'EXPORT', 'EDIT_ITEM'],
    allowedPageActions: {},
  };

  // 内置管理员保留页面级按钮配置能力；菜单、全局动作和数据范围仍不可降级。
  assert.equal(
    detectProtectedAdminPrivilegeChange('r1', existingAdmin, { allowedPageActions: { MENU_WORKBENCH: ['READ'] } }),
    null,
  );
  assert.equal(
    detectProtectedAdminPrivilegeChange('r1', existingAdmin, { permissions: ['MENU_WORKBENCH'] }),
    'permissions',
  );
  assert.equal(
    detectProtectedAdminPrivilegeChange('r1', existingAdmin, { dataScope: 'SELF' }),
    'dataScope',
  );
  assert.equal(
    detectProtectedAdminPrivilegeChange('r1', existingAdmin, { followerDataScope: 'SELF' }),
    'followerDataScope',
  );
  assert.equal(
    detectProtectedAdminPrivilegeChange('r1', existingAdmin, { allowedActions: ['READ'] }),
    'allowedActions',
  );
  assert.equal(
    detectProtectedAdminPrivilegeChange('r1', existingAdmin, { customUserIds: ['u1'] }),
    'customUserIds',
  );
  assert.equal(detectProtectedAdminPrivilegeChange('r1', existingAdmin, { name: '系统管理员' }), null);
  assert.equal(
    detectProtectedAdminPrivilegeChange('r2', existingAdmin, { dataScope: 'SELF', allowedPageActions: { MENU_WORKBENCH: ['READ'] } }),
    null,
  );
});
