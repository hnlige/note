import test from 'node:test';
import assert from 'node:assert/strict';

test('POST log route denies export-only roles and accepts edit-system roles', async () => {
  const logsModule = await import('./logs');
  const canPostOperationLog = (logsModule as typeof logsModule & {
    canPostOperationLog?: (role: unknown) => boolean;
  }).canPostOperationLog;

  assert.equal(typeof canPostOperationLog, 'function');
  assert.equal(canPostOperationLog?.({
    permissions: ['MENU_LOGS'],
    allowedActions: ['READ'],
    allowedPageActions: { MENU_LOGS: ['EXPORT'] },
  }), false);
  assert.equal(canPostOperationLog?.({
    permissions: ['MENU_LOGS'],
    allowedActions: ['READ'],
    allowedPageActions: { MENU_LOGS: ['EDIT_SYSTEM'] },
  }), true);
  assert.equal(canPostOperationLog?.({
    permissions: ['MENU_WORKBENCH'],
    allowedActions: ['READ'],
    allowedPageActions: { MENU_WORKBENCH: ['SIGN_ITEM'] },
  }), true);
  assert.equal(canPostOperationLog?.({
    permissions: ['MENU_ITEMS'],
    allowedActions: ['READ', 'EDIT_ITEM'],
  }), true);
  assert.equal(canPostOperationLog?.({
    permissions: ['MENU_ITEMS'],
    allowedActions: ['READ', 'SEARCH', 'EXPORT'],
  }), false);
});

test('operation log body and query limit validation fail closed', async () => {
  const logsModule = await import('./logs');
  const parseOperationLogBody = (logsModule as typeof logsModule & {
    parseOperationLogBody?: (body: unknown) => { action: string; module: string; detail: string } | null;
  }).parseOperationLogBody;
  const parseLogLimit = (logsModule as typeof logsModule & {
    parseLogLimit?: (value: unknown) => number | null;
  }).parseLogLimit;

  assert.equal(typeof parseOperationLogBody, 'function');
  assert.deepEqual(parseOperationLogBody?.({ action: ' 修改配置 ', module: ' 系统配置 ', detail: ' 说明 ' }), {
    action: '修改配置', module: '系统配置', detail: '说明',
  });
  for (const body of [undefined, null, {}, { action: '' }, { action: {} }, { action: 'x'.repeat(201) }, { action: 'ok', module: {} }, { action: 'ok', module: 'x'.repeat(51) }]) {
    assert.equal(parseOperationLogBody?.(body), null);
  }

  assert.equal(typeof parseLogLimit, 'function');
  assert.equal(parseLogLimit?.(undefined), 200);
  assert.equal(parseLogLimit?.('1'), 1);
  assert.equal(parseLogLimit?.('500'), 500);
  for (const value of ['0', '-1', '1.5', '501', 'abc', ['10']]) {
    assert.equal(parseLogLimit?.(value), null);
  }
});

test('POST log values ignore forged identity, network, id, and timestamp fields', async () => {
  const logsModule = await import('./logs');
  const buildOperationLogValues = (logsModule as typeof logsModule & {
    buildOperationLogValues?: (input: unknown) => Record<string, unknown> | null;
  }).buildOperationLogValues;
  const now = new Date('2026-08-08T10:00:00.000Z');

  assert.equal(typeof buildOperationLogValues, 'function');
  assert.deepEqual(buildOperationLogValues?.({
    body: {
      id: 'forged-id', userId: 'forged-user', userName: '伪造用户', ip: '8.8.8.8', timestamp: '2000-01-01',
      action: '修改配置', module: '系统配置', detail: '安全操作', extra: 'ignored',
    },
    authUser: { id: 'auth-user' },
    currentUser: { id: 'auth-user', name: '真实用户' },
    requestIp: '127.0.0.9',
    id: 'server-uuid',
    now,
  }), {
    id: 'server-uuid', userId: 'auth-user', userName: '真实用户', action: '修改配置', module: '系统配置',
    detail: '安全操作', ip: '127.0.0.9', timestamp: now,
  });

  assert.equal(buildOperationLogValues?.({
    authUser: { id: 'auth-user', name: '会话用户' },
    currentUser: { id: 'different-user', name: '其他用户' },
  }), null);
  assert.equal(buildOperationLogValues?.({
    authUser: { id: 'auth-user', name: '会话用户' },
  }), null);
  assert.equal(buildOperationLogValues?.({
    authUser: { name: '缺失标识' },
    currentUser: { id: 'auth-user', name: '当前用户' },
  }), null);
  assert.equal(buildOperationLogValues?.({
    authUser: { id: 'auth-user', name: '会话用户' },
    currentUser: { id: 'auth-user' },
    body: { action: '测试操作' },
  })?.userName, 'auth-user');
});

test('POST log values generate a server id when the request does not provide one', async () => {
  const { buildOperationLogValues } = await import('./logs');
  const values = buildOperationLogValues({
    body: { action: '测试操作' },
    authUser: { id: 'auth-user' },
    currentUser: { id: 'auth-user', name: '真实用户' },
  });
  assert.match(values?.id || '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('logs endpoint remains protected from unauthenticated and export-only writes', async () => {
  const { requireAuth } = await import('./auth.middleware');
  const authState: { status?: number } = {};
  requireAuth({ headers: {} } as never, {
    status(code: number) { authState.status = code; return this; },
    json() { return this; },
  } as never, () => { throw new Error('unauthenticated request reached route'); });
  assert.equal(authState.status, 401);

  const { canPostOperationLog } = await import('./logs');
  assert.equal(canPostOperationLog({
    permissions: ['MENU_LOGS'],
    allowedActions: ['READ'],
    allowedPageActions: { MENU_LOGS: ['EXPORT'] },
  }), false);
});
