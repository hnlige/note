import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_ACTION_CATALOG,
  pageSupportsAction,
  parseAllowedPageActions,
  hasPageAction,
} from './page-actions';

test('工作台目录包含导入模板与批量导入按钮级 action', () => {
  const actions = PAGE_ACTION_CATALOG.get('MENU_WORKBENCH') || [];
  assert.ok(actions.includes('READ'), '应包含只读');
  assert.ok(actions.includes('CREATE_ITEM'), '应包含发起督办');
  assert.ok(actions.includes('EXPORT'), '应包含全量导出');
  assert.ok(actions.includes('DOWNLOAD_TEMPLATE'), '应包含导入模板');
  assert.ok(actions.includes('BATCH_IMPORT'), '应包含批量导入');
});

test('pageSupportsAction 认可工作台新增按钮级 action', () => {
  assert.equal(pageSupportsAction('MENU_WORKBENCH', 'DOWNLOAD_TEMPLATE'), true);
  assert.equal(pageSupportsAction('MENU_WORKBENCH', 'BATCH_IMPORT'), true);
  assert.equal(pageSupportsAction('MENU_WORKBENCH', 'UNKNOWN_ACTION'), false);
});

test('parseAllowedPageActions 保留工作台新增按钮级 action（保存后不丢值）', () => {
  const parsed = parseAllowedPageActions({
    MENU_WORKBENCH: ['READ', 'CREATE_ITEM', 'DOWNLOAD_TEMPLATE', 'BATCH_IMPORT'],
  });
  assert.deepEqual(
    (parsed.MENU_WORKBENCH || []).slice().sort(),
    ['BATCH_IMPORT', 'CREATE_ITEM', 'DOWNLOAD_TEMPLATE', 'READ'],
  );
});

test('hasPageAction 对授予新增按钮级 action 的角色返回 true', () => {
  const role = {
    authCodes: ['MENU_WORKBENCH'],
    allowedActions: ['READ'],
    allowedPageActions: { MENU_WORKBENCH: ['DOWNLOAD_TEMPLATE', 'BATCH_IMPORT'] },
  };
  assert.equal(hasPageAction(role, 'MENU_WORKBENCH', 'DOWNLOAD_TEMPLATE'), true);
  assert.equal(hasPageAction(role, 'MENU_WORKBENCH', 'BATCH_IMPORT'), true);
  assert.equal(hasPageAction(role, 'MENU_WORKBENCH', 'EXPORT'), false);
});

test('hasPageAction 页面级显式排除优先于全局 allowedActions 回退', () => {
  // 复现「角色配置页取消变更按钮后旧全局授权仍放行」的口径不一致：
  // 页面已显式配置按钮列表且不含 CHANGE_ITEM 时，即使全局 allowedActions
  // 仍包含 CHANGE_ITEM 也必须拒绝（与前端 canUsePageAction 口径对齐）。
  const role = {
    authCodes: ['MENU_ITEMS'],
    allowedActions: ['READ', 'SEARCH', 'CHANGE_ITEM'],
    allowedPageActions: { MENU_ITEMS: ['READ', 'SEARCH', 'URGE_ITEM'] },
  };
  assert.equal(hasPageAction(role, 'MENU_ITEMS', 'CHANGE_ITEM'), false);
  assert.equal(hasPageAction(role, 'MENU_ITEMS', 'URGE_ITEM'), true);
  // 未配置页面级的页面仍回退全局授权
  assert.equal(hasPageAction(role, 'MENU_WORKBENCH', 'CHANGE_ITEM'), true);
});
