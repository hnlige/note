import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNewRole,
  canManageRolePermissions,
  canToggleAllowedAction,
  getEditableAuthCodes,
  isPageActionChecked,
  isPermissionChecked,
  toggleAllowedAction,
  togglePageAllowedAction,
  togglePermissionCode,
} from './role-permissions.ts';
import {
  getAllConfigurableActionCodes,
  getAllPermissionCodes,
  getActionLabelsByCode,
  PERMISSION_TREE,
} from './permission-catalog.ts';
import {
  getPageAuthCodesSupportingAction,
  pageSupportsAction,
} from '../../../permissions/page-actions.ts';

test('toggleAllowedAction adds an unchecked action to allowedActions', () => {
  assert.deepEqual(toggleAllowedAction(['READ'], 'EDIT_ITEM'), ['READ', 'EDIT_ITEM']);
});

test('toggleAllowedAction removes a checked action from allowedActions', () => {
  assert.deepEqual(toggleAllowedAction(['READ', 'EDIT_ITEM'], 'EDIT_ITEM'), ['READ']);
});

test('toggleAllowedAction starts from an empty action list when allowedActions is missing', () => {
  assert.deepEqual(toggleAllowedAction(undefined, 'SEARCH'), ['SEARCH']);
});

test('canToggleAllowedAction allows base actions while operation limits are being configured', () => {
  assert.equal(canToggleAllowedAction('READ'), true);
  assert.equal(canToggleAllowedAction('SEARCH'), true);
  assert.equal(canToggleAllowedAction('EXPORT'), true);
});

test('canToggleAllowedAction allows every page button action from the permission tree', () => {
  getAllConfigurableActionCodes(PERMISSION_TREE).forEach((action) => {
    assert.equal(canToggleAllowedAction(action), true, `${action} should be configurable`);
  });
});

test('togglePageAllowedAction adds and removes actions per page', () => {
  assert.deepEqual(togglePageAllowedAction({}, 'MENU_ITEMS', 'EXPORT'), {
    MENU_ITEMS: ['EXPORT'],
  });
  assert.deepEqual(togglePageAllowedAction({ MENU_ITEMS: ['EXPORT', 'READ'] }, 'MENU_ITEMS', 'EXPORT'), {
    MENU_ITEMS: ['READ'],
  });
});

test('isPageActionChecked shows legacy global actions on supported pages', () => {
  assert.equal(isPageActionChecked({ allowedActions: ['EXPORT'] } as any, 'MENU_ITEMS', 'EXPORT'), true);
  assert.equal(isPageActionChecked({ allowedActions: ['EXPORT'] } as any, 'MENU_STATISTICS', 'EXPORT'), true);
  assert.equal(isPageActionChecked({ allowedActions: ['EXPORT'] } as any, 'MENU_MY_ITEMS', 'EXPORT'), false);
});

test('isPageActionChecked treats missing and empty action lists as no grant (unchecked)', () => {
  // 空/未配置全局操作权限表示“无按钮授权”，不再等同于“全部允许”，
  // 因此缺省为不勾选，需显式配置 allowedPageActions 才会勾选。
  assert.equal(isPageActionChecked({ allowedActions: undefined } as any, 'MENU_ITEMS', 'EXPORT'), false);
  assert.equal(isPageActionChecked({ allowedActions: [] } as any, 'MENU_ITEMS', 'EXPORT'), false);
  assert.equal(isPageActionChecked({ allowedActions: undefined } as any, 'MENU_MY_ITEMS', 'EXPORT'), false);
  assert.equal(isPageActionChecked({ allowedActions: [] } as any, 'MENU_MY_ITEMS', 'EXPORT'), false);
});

test('isPageActionChecked applies catalog limits to ALL roles', () => {
  const role = {
    authCodes: ['ALL'],
    allowedActions: ['READ'],
  } as any;

  assert.equal(isPageActionChecked(role, 'MENU_ITEMS', 'EXPORT'), true);
  assert.equal(isPageActionChecked(role, 'MENU_MY_ITEMS', 'EXPORT'), false);
});

test('isPageActionChecked honors explicit page actions independently', () => {
  const role = {
    allowedActions: ['READ', 'SEARCH'],
    allowedPageActions: { MENU_ITEMS: ['EXPORT'] },
  } as any;
  assert.equal(isPageActionChecked(role, 'MENU_ITEMS', 'EXPORT'), true);
  assert.equal(isPageActionChecked(role, 'MENU_STATISTICS', 'EXPORT'), false);
});

test('isPageActionChecked rejects unsupported explicit page actions', () => {
  const role = {
    allowedActions: ['READ'],
    allowedPageActions: { MENU_MY_ITEMS: ['EXPORT'] },
  } as any;

  assert.equal(isPageActionChecked(role, 'MENU_MY_ITEMS', 'EXPORT'), false);
});

test('isPageActionChecked respects explicit allowedPageActions for built-in admin (ALL) role', () => {
  const adminRole = {
    authCodes: ['ALL'],
    allowedActions: ['READ', 'SEARCH', 'EXPORT', 'CREATE_ITEM'],
    // 显式收口内置管理员的工作台按钮，验证放开后配置在 UI 勾选态上真实反映。
    allowedPageActions: { MENU_WORKBENCH: ['READ', 'EXPORT'] },
  } as any;

  assert.equal(isPageActionChecked(adminRole, 'MENU_WORKBENCH', 'READ'), true);
  assert.equal(isPageActionChecked(adminRole, 'MENU_WORKBENCH', 'EXPORT'), true);
  // 未在该页面显式配置的按钮不再被 authCodes=ALL 强制勾选。
  assert.equal(isPageActionChecked(adminRole, 'MENU_WORKBENCH', 'CREATE_ITEM'), false);
});

test('permission tree exposes system menu page auth codes and button actions', () => {
  assert.deepEqual(getAllPermissionCodes(PERMISSION_TREE), [
    'MENU_WORKBENCH',
    'MENU_MY_ITEMS',
    'MENU_ITEMS',
    'MENU_AUDIT',
    'MENU_ARCHIVES',
    'MENU_RECYCLE_BIN',
    'MENU_STATISTICS',
    'MENU_MONITORING',
    'MENU_LIGHTS',
    'MENU_MESSAGES',
    'MENU_ORG',
    'MENU_ROLES',
    'MENU_TEMPLATES',
    'MENU_RULES',
    'MENU_SYSTEM',
    'MENU_WECOM',
    'MENU_LOGS',
    'MENU_TASKS',
  ]);
  assert.deepEqual(getAllConfigurableActionCodes(PERMISSION_TREE), [
    'READ',
    'SEARCH',
    'EXPORT',
    'CREATE_ITEM',
    'EDIT_ITEM',
    'DELETE_ITEM',
    'SIGN_ITEM',
    'FEEDBACK_ITEM',
    'DELAY_ITEM',
    'URGE_ITEM',
    'CHANGE_ITEM',
    'SUSPEND_ITEM',
    'RESTART_ITEM',
    'DISABLE_ITEM',
    'REJECT_ITEM',
    'APPROVE_ITEM',
    'APPLY_COMPLETE_ITEM',
    'MARK_UNSATISFIED_ITEM',
    'SHARE_ITEM',
    'EDIT_SYSTEM',
    'DOWNLOAD_TEMPLATE',
    'BATCH_IMPORT',
  ]);
});

test('getActionLabelsByCode resolves labels for the operation summary', () => {
  assert.deepEqual(getActionLabelsByCode(['READ', 'CREATE_ITEM', 'EDIT_SYSTEM']), ['只读', '发起督办', '系统设置']);
});

test('page action catalog exposes the current export-capable pages', () => {
  assert.deepEqual(getPageAuthCodesSupportingAction('EXPORT'), [
    'MENU_WORKBENCH',
    'MENU_ITEMS',
    'MENU_ARCHIVES',
    'MENU_STATISTICS',
    'MENU_LOGS',
  ]);
});

test('pageSupportsAction only allows actions configured on that page', () => {
  assert.equal(pageSupportsAction('MENU_ITEMS', 'EXPORT'), true);
  assert.equal(pageSupportsAction('MENU_MY_ITEMS', 'EXPORT'), false);
  assert.equal(pageSupportsAction('MENU_STATISTICS', 'EXPORT'), true);
});

test('workbench catalog owns its visible sign and feedback actions', () => {
  assert.equal(pageSupportsAction('MENU_WORKBENCH', 'SIGN_ITEM'), true);
  assert.equal(pageSupportsAction('MENU_WORKBENCH', 'FEEDBACK_ITEM'), true);
});

test('buildNewRole creates a persistable role draft with default workbench access', () => {
  assert.deepEqual(buildNewRole('r-new', '督办管理员'), {
    id: 'r-new',
    name: '督办管理员',
    authCodes: ['MENU_WORKBENCH'],
    dataScope: 'SELF',
    followerDataScope: undefined,
    orgIds: [],
    customUserIds: [],
    ownerCustomUserIds: [],
    followerCustomUserIds: [],
    allowedActions: ['READ', 'SEARCH'],
    allowedPageActions: {
      MENU_WORKBENCH: ['READ', 'SEARCH'],
    },
  });
});

test('getEditableAuthCodes expands ALL into explicit module permissions for editing', () => {
  assert.deepEqual(
    getEditableAuthCodes(['ALL'], ['MENU_WORKBENCH', 'MENU_ITEMS', 'MENU_ROLES']),
    ['MENU_WORKBENCH', 'MENU_ITEMS', 'MENU_ROLES'],
  );
});

test('togglePermissionCode converts ALL into explicit permissions before unchecking a single module', () => {
  assert.deepEqual(
    togglePermissionCode(['ALL'], 'MENU_ITEMS', ['MENU_WORKBENCH', 'MENU_ITEMS', 'MENU_ROLES']),
    ['MENU_WORKBENCH', 'MENU_ROLES'],
  );
});

test('isPermissionChecked only treats ALL as selected while the editable draft remains unexpanded', () => {
  assert.equal(isPermissionChecked(['ALL'], 'MENU_ITEMS'), true);
  assert.equal(isPermissionChecked(['MENU_WORKBENCH'], 'MENU_ITEMS'), false);
});

test('canManageRolePermissions keeps management buttons visible for administrator fallback', () => {
  assert.equal(
    canManageRolePermissions({ role: 'ADMIN', roleId: 'missing-role' }, []),
    true,
  );
});
