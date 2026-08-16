import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('log export builds Chinese columns from every filtered row with safe empty cells', async () => {
  const modulePath = './logs-export';
  const exportModule = await import(modulePath).catch(() => null) as null | {
    buildLogsExport: (logs: Array<Record<string, unknown>>) => { headers: string[]; rows: unknown[][] };
  };

  assert.ok(exportModule);
  assert.deepEqual(exportModule?.buildLogsExport([
    { timestamp: '2026-08-07 09:00:00', userName: '张三', module: '督办事项', action: '导出,"日志"', ip: undefined },
    { timestamp: '2026-08-07 10:00:00', userName: '李四', module: '系统', action: '查看', ip: '10.0.0.2' },
  ]), {
    headers: ['时间', '用户', '模块', '操作', 'IP'],
    rows: [
      ['2026-08-07 09:00:00', '张三', '督办事项', '导出,"日志"', ''],
      ['2026-08-07 10:00:00', '李四', '系统', '查看', '10.0.0.2'],
    ],
  });
});

test('log keyword matching tolerates nullable historical fields', async () => {
  const exportModule = await import('./logs-export') as typeof import('./logs-export') & {
    matchesLogKeyword?: (log: Record<string, unknown>, keyword: string) => boolean;
  };

  assert.equal(typeof exportModule.matchesLogKeyword, 'function');
  assert.equal(exportModule.matchesLogKeyword?.({ userName: null, action: '事项删除', module: null, ip: null, timestamp: null }, '删除'), true);
  assert.equal(exportModule.matchesLogKeyword?.({ userName: null, action: null, module: null, ip: null, timestamp: null }, '删除'), false);
});

test('logs page gates and performs CSV export through the shared page-action pattern', async () => {
  const source = await readFile(new URL('./Logs.tsx', import.meta.url), 'utf8');

  assert.match(source, /canExportLogs\(currentUser,\s*roles\)/);
  assert.match(source, /downloadCsv\(/);
  assert.match(source, /canExport\s*&&/);
});

test('logs export requires menu access and export action while preserving ALL', async () => {
  const modulePath = './logs-export';
  const exportModule = await import(modulePath) as typeof import('./logs-export');
  const user = { roleId: 'logs-role' };

  assert.equal(exportModule.canExportLogs(user, [{
    id: 'logs-role',
    name: '仅动作角色',
    authCodes: ['MENU_ITEMS'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
    allowedPageActions: { MENU_LOGS: ['EXPORT'] },
  }]), false);
  assert.equal(exportModule.canExportLogs(user, [{
    id: 'logs-role',
    name: '日志导出角色',
    authCodes: ['MENU_LOGS'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
    allowedPageActions: { MENU_LOGS: ['EXPORT'] },
  }]), true);
  assert.equal(exportModule.canExportLogs(user, [{
    id: 'logs-role',
    name: '全权限角色',
    authCodes: ['ALL'],
    dataScope: 'ALL',
    allowedActions: ['READ'],
  }]), true);
});
