import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  canManageRoles,
  canViewRoles,
  canManageUsers,
  canReadUsers,
  canManageMessages,
  canManageUrges,
  canReplyUrge,
  canManageActivities,
  canManageAudit,
  canManageAsyncTasks,
  canManageDepartments,
  canManageDictionaries,
  canManageGlobalRules,
  canManageLights,
  canManageLogs,
  canManageTemplates,
  canReadActivities,
  canReadAudit,
  canReadAsyncTasks,
  canReadDepartments,
  canReadDictionaries,
  canReadGlobalRules,
  canReadLights,
  canReadLogs,
  canReadTemplates,
  canReadMessages,
  canReadUrges,
  getMessageTargetIdentities,
  hasPageAction,
  isMessageVisibleToUser,
  isUrgeVisibleToUser,
} from './module-authz';
import { PAGE_ACTION_CATALOG, pageSupportsAction, parseAllowedPageActions } from './page-actions';

const adminRole = {
  id: 'r1',
  permissions: ['ALL'],
  allowedActions: [],
};

const messageRole = {
  id: 'r2',
  permissions: ['MENU_MESSAGES'],
  allowedActions: ['READ', 'SEARCH'],
};

const monitoringRole = {
  id: 'r3',
  permissions: ['MENU_MONITORING', 'MENU_MESSAGES'],
  allowedActions: ['READ', 'SEARCH', 'URGE_ITEM'],
};

const rolesViewerRole = {
  id: 'r7',
  permissions: ['MENU_ROLES'],
  allowedActions: [],
};

const rolesReadOnlyRole = {
  id: 'r7-read',
  permissions: ['MENU_ROLES'],
  allowedActions: ['READ', 'SEARCH'],
};

const rolesEditorRole = {
  id: 'r7-edit',
  permissions: ['MENU_ROLES'],
  allowedActions: ['READ', 'SEARCH', 'EDIT_SYSTEM'],
};

const ownerRole = {
  id: 'r6',
  permissions: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MESSAGES'],
  allowedActions: ['READ', 'SEARCH', 'SIGN_ITEM', 'FEEDBACK_ITEM'],
};

const orgManagerRole = {
  id: 'r8',
  permissions: ['MENU_ORG'],
  allowedActions: ['READ', 'EDIT_SYSTEM'],
};

const systemConfigRole = {
  id: 'r9',
  permissions: ['MENU_TEMPLATES', 'MENU_RULES', 'MENU_SYSTEM', 'MENU_WECOM', 'MENU_LOGS', 'MENU_TASKS'],
  allowedActions: ['READ', 'EDIT_SYSTEM'],
};

const auditAndLightRole = {
  id: 'r10',
  permissions: ['MENU_AUDIT', 'MENU_LIGHTS'],
  allowedActions: ['READ', 'APPROVE_ITEM', 'EDIT_SYSTEM'],
};

test('admin-only modules require valid admin role permissions', () => {
  assert.equal(canManageRoles(adminRole), true);
  assert.equal(canManageUsers(adminRole), true);
  assert.equal(canReadUsers(adminRole), true);
  assert.equal(canManageRoles(messageRole), false);
  assert.equal(canManageUsers(messageRole), false);
});

test('canManageRoles and canViewRoles both honor MENU_ROLES and ALL', () => {
  // 超级管理员可以查看和管理
  assert.equal(canViewRoles(adminRole), true);
  assert.equal(canManageRoles(adminRole), true);
  // 持有 MENU_ROLES 菜单即可管理角色（与前端 canManageRolePermissions 对齐：MENU_ROLES/ALL/EDIT_SYSTEM/ADMIN 任一即放行）。
  // 旧实现额外要求 EDIT_SYSTEM 页面动作，导致仅持有 MENU_ROLES 菜单的内置管理员每次保存角色都被 403 拒绝。
  assert.equal(canViewRoles(rolesViewerRole), true);
  assert.equal(canManageRoles(rolesViewerRole), false);
  // EDIT_SYSTEM 页面动作同样放行管理（按钮级授权路径）
  assert.equal(canViewRoles(rolesReadOnlyRole), true);
  assert.equal(canManageRoles(rolesReadOnlyRole), false);
  assert.equal(canViewRoles(rolesEditorRole), true);
  assert.equal(canManageRoles(rolesEditorRole), true);
  // 无 MENU_ROLES 也无 ALL 的角色不能查看也不能管理
  assert.equal(canViewRoles(messageRole), false);
  assert.equal(canManageRoles(messageRole), false);
});

test('direct module managers deny malformed allowedActions', () => {
  const managementChecks = [
    { name: 'users', permissions: ['MENU_ORG'], check: canManageUsers },
    { name: 'departments', permissions: ['MENU_ORG'], check: canManageDepartments },
    { name: 'templates', permissions: ['MENU_TEMPLATES'], check: canManageTemplates },
    { name: 'dictionaries', permissions: ['MENU_SYSTEM'], check: canManageDictionaries },
    { name: 'audit', permissions: ['MENU_AUDIT'], check: canManageAudit },
    { name: 'async tasks', permissions: ['MENU_TASKS'], check: canManageAsyncTasks },
    { name: 'lights', permissions: ['MENU_LIGHTS'], check: canManageLights },
    { name: 'global rules', permissions: ['MENU_RULES'], check: canManageGlobalRules },
    { name: 'urges', permissions: ['MENU_MONITORING'], check: canManageUrges },
  ];
  const malformedValues = [
    '{bad json}',
    'null',
    'EDIT_SYSTEM',
    ['EDIT_SYSTEM', 7],
    null,
  ];

  for (const { name, permissions, check } of managementChecks) {
    for (const allowedActions of malformedValues) {
      assert.equal(
        check({ permissions, allowedActions }),
        false,
        `${name} accepted malformed allowedActions: ${JSON.stringify(allowedActions)}`,
      );
    }
  }
});

test('direct module managers deny empty grants and preserve ALL behavior', () => {
  const managementChecks = [
    canManageUsers,
    canManageDepartments,
    canManageTemplates,
    canManageDictionaries,
    canManageAudit,
    canManageAsyncTasks,
    canManageLights,
    canManageGlobalRules,
    canManageUrges,
  ];

  for (const check of managementChecks) {
    assert.equal(check({ permissions: ['ALL'], allowedActions: '{bad json}' }), true);
  }

  for (const allowedActions of [undefined, [], '[]']) {
    assert.equal(canManageUsers({ permissions: ['MENU_ORG'], allowedActions }), false);
    assert.equal(canManageTemplates({ permissions: ['MENU_TEMPLATES'], allowedActions }), false);
  }
});

test('hasPageAction allows legacy EXPORT on every export-capable page', () => {
  const role = { permissions: ['MENU_ITEMS', 'MENU_STATISTICS'], allowedActions: ['READ', 'SEARCH', 'EXPORT'] };

  assert.equal(hasPageAction(role, 'MENU_WORKBENCH', 'EXPORT'), true);
  assert.equal(hasPageAction(role, 'MENU_ITEMS', 'EXPORT'), true);
  assert.equal(hasPageAction(role, 'MENU_ARCHIVES', 'EXPORT'), true);
  assert.equal(hasPageAction(role, 'MENU_STATISTICS', 'EXPORT'), true);
  assert.equal(hasPageAction(role, 'MENU_LOGS', 'EXPORT'), true);
  assert.equal(hasPageAction(role, 'MENU_MY_ITEMS', 'EXPORT'), false);
});

test('hasPageAction honors object and JSON page grants independently', () => {
  const objectMapRole = {
    permissions: ['MENU_ITEMS', 'MENU_STATISTICS'],
    allowedActions: ['READ', 'SEARCH'],
    allowedPageActions: { MENU_ITEMS: ['EXPORT'] },
  };
  const jsonMapRole = {
    permissions: ['MENU_ITEMS', 'MENU_STATISTICS'],
    allowedActions: ['READ', 'SEARCH'],
    allowedPageActions: '{"MENU_STATISTICS":["EXPORT"]}',
  };

  assert.equal(hasPageAction(objectMapRole, 'MENU_ITEMS', 'EXPORT'), true);
  assert.equal(hasPageAction(objectMapRole, 'MENU_STATISTICS', 'EXPORT'), false);
  assert.equal(hasPageAction(jsonMapRole, 'MENU_STATISTICS', 'EXPORT'), true);
  assert.equal(hasPageAction(jsonMapRole, 'MENU_ITEMS', 'EXPORT'), false);
});

test('hasPageAction rejects unsupported page-action combinations before ALL or explicit grants', () => {
  const role = {
    permissions: ['ALL'],
    allowedActions: ['UNKNOWN_ACTION'],
    allowedPageActions: { MENU_ITEMS: ['EXPORT'], MENU_UNKNOWN: ['READ'] },
  };

  assert.equal(hasPageAction(role, 'MENU_ITEMS', 'UNKNOWN_ACTION'), false);
  assert.equal(hasPageAction(role, 'MENU_UNKNOWN', 'READ'), false);
  assert.equal(hasPageAction({ permissions: ['MENU_ITEMS'], allowedActions: ['READ'], allowedPageActions: '{bad json}' }, 'MENU_ITEMS', 'EXPORT'), false);
});

test('hasPageAction treats missing or empty global actions as no authorization', () => {
  assert.equal(hasPageAction({ permissions: ['MENU_ITEMS'], allowedActions: [] }, 'MENU_ITEMS', 'DELETE_ITEM'), false);
  assert.equal(hasPageAction({ permissions: ['MENU_ITEMS'] }, 'MENU_ITEMS', 'DELETE_ITEM'), false);
  assert.equal(hasPageAction({ permissions: ['MENU_ITEMS'], allowedActions: '[]' }, 'MENU_ITEMS', 'DELETE_ITEM'), false);
  assert.equal(hasPageAction({ permissions: ['MENU_ITEMS'], allowedActions: [], allowedPageActions: { MENU_ITEMS: [] } }, 'MENU_ITEMS', 'DELETE_ITEM'), false);
  assert.equal(hasPageAction({ authCodes: ['ALL'], allowedActions: ['READ'] }, 'MENU_ROLES', 'EDIT_SYSTEM'), true);
});

test('hasPageAction denies malformed global action values', () => {
  const malformedValues = [
    'EXPORT',
    '',
    '{bad json}',
    '"EXPORT"',
    'null',
    JSON.stringify(JSON.stringify(['EXPORT'])),
    ['EXPORT', 7],
    ['EXPORT', ''],
    { action: 'EXPORT' },
    7,
    true,
    null,
  ];

  for (const allowedActions of malformedValues) {
    assert.equal(
      hasPageAction({ permissions: ['MENU_ITEMS'], allowedActions }, 'MENU_ITEMS', 'EXPORT'),
      false,
      `malformed allowedActions granted EXPORT: ${JSON.stringify(allowedActions)}`,
    );
  }
});

test('page action lookups deny dangerous, unknown, and inherited page keys without throwing', () => {
  const unsafePageAuths = [
    '__proto__',
    'constructor',
    'prototype',
    'toString',
    'hasOwnProperty',
    'MENU_UNKNOWN',
  ];
  const unsafePageMap = JSON.parse(`{
    "__proto__":["READ"],
    "constructor":["READ"],
    "prototype":["READ"],
    "toString":["READ"],
    "MENU_UNKNOWN":["READ"]
  }`);

  for (const pageAuth of unsafePageAuths) {
    let supportsAction: boolean | undefined;
    let hasAction: boolean | undefined;

    assert.doesNotThrow(() => {
      supportsAction = pageSupportsAction(pageAuth, 'READ');
    });
    assert.equal(supportsAction, false);

    assert.doesNotThrow(() => {
      hasAction = hasPageAction(
        { permissions: ['ALL'], allowedActions: [], allowedPageActions: unsafePageMap },
        pageAuth,
        'READ',
      );
    });
    assert.equal(hasAction, false);
  }

  let parsedUnsafeMap: Record<string, string[]> | undefined;
  assert.doesNotThrow(() => {
    parsedUnsafeMap = parseAllowedPageActions(unsafePageMap);
  });
  assert.deepEqual(Object.keys(parsedUnsafeMap || {}), []);

  const inheritedPageMap = Object.create({ MENU_ITEMS: ['EXPORT'] });
  assert.equal(
    hasPageAction(
      { permissions: ['MENU_ITEMS'], allowedActions: ['READ'], allowedPageActions: inheritedPageMap },
      'MENU_ITEMS',
      'EXPORT',
    ),
    false,
  );
});

test('backend page-action catalog exactly matches the frontend permission tree boundary', async () => {
  const frontendCatalogUrl = pathToFileURL(resolve(__dirname, '../../../src/permissions/page-actions.ts')).href;
  const frontendModule = await import(frontendCatalogUrl) as {
    PERMISSION_TREE: Array<{
      children: Array<{
        auth: string;
        actions: Array<{ value: string }>;
      }>;
    }>;
  };

  const frontendPages = frontendModule.PERMISSION_TREE.flatMap((group) => group.children);
  const frontendActions = [...new Set(frontendPages.flatMap((page) => page.actions.map((action) => action.value)))];
  const frontendCombinations = frontendPages.reduce((total, page) => total + page.actions.length, 0);
  const backendActions = [...new Set([...PAGE_ACTION_CATALOG.values()].flatMap((actions) => [...actions]))];
  const backendCombinations = [...PAGE_ACTION_CATALOG.values()].reduce((total, actions) => total + actions.length, 0);

  assert.equal(frontendPages.length, 18);
  assert.equal(frontendActions.length, 22);
  assert.equal(frontendCombinations, 96);
  assert.equal(PAGE_ACTION_CATALOG.size, 18);
  assert.equal(backendActions.length, 22);
  assert.equal(backendCombinations, 96);

  const normalizeCatalog = (entries: Iterable<readonly [string, readonly string[]]>) =>
    [...entries]
      .map(([pageAuth, actions]) => [pageAuth, [...new Set(actions)].sort()] as const)
      .sort(([leftPage], [rightPage]) => leftPage.localeCompare(rightPage));

  assert.deepEqual(
    normalizeCatalog(PAGE_ACTION_CATALOG),
    normalizeCatalog(frontendPages.map((page) => [page.auth, page.actions.map((action) => action.value)])),
  );

  for (const page of frontendPages) {
    const supportedActions = new Set(page.actions.map((action) => action.value));
    for (const action of frontendActions) {
      assert.equal(
        pageSupportsAction(page.auth, action),
        supportedActions.has(action),
        `${page.auth} + ${action} drifted from frontend PERMISSION_TREE`,
      );
    }
  }
});

test('module managers require their page-scoped management grants', () => {
  assert.equal(canManageLogs({ permissions: ['MENU_LOGS'], allowedActions: ['READ'], allowedPageActions: { MENU_LOGS: ['SEARCH'] } }), false);
  assert.equal(canManageLogs({ permissions: ['MENU_LOGS'], allowedActions: ['READ'], allowedPageActions: { MENU_LOGS: ['EXPORT'] } }), false);
  assert.equal(canManageLogs({ permissions: ['MENU_LOGS'], allowedActions: ['READ'], allowedPageActions: { MENU_LOGS: ['EDIT_SYSTEM'] } }), true);
  assert.equal(canManageRoles({ permissions: ['MENU_ROLES'], allowedActions: ['READ'], allowedPageActions: { MENU_ROLES: ['READ'] } }), false);
  assert.equal(canManageRoles({ permissions: ['MENU_ROLES'], allowedActions: ['READ'], allowedPageActions: { MENU_ROLES: ['EDIT_SYSTEM'] } }), true);
});

test('message and urge modules require their own permissions', () => {
  assert.equal(canReadMessages(messageRole), true);
  assert.equal(canManageMessages(messageRole), true);
  assert.equal(canReadUrges(monitoringRole), true);
  assert.equal(canManageUrges(monitoringRole), true);
  assert.equal(canReadUrges(messageRole), false);
});

test('urge replies are allowed for message-capable recipients without monitoring permission', () => {
  assert.equal(canReplyUrge(ownerRole), true);
  assert.equal(canReplyUrge(messageRole), true);
  assert.equal(canReplyUrge(monitoringRole), true);
  assert.equal(canReplyUrge(adminRole), true);
  assert.equal(canReplyUrge({ permissions: ['MENU_ITEMS'] }), false);
});

test('system modules require their matching menu permissions and deny ordinary owners', () => {
  assert.equal(canReadDepartments(orgManagerRole), true);
  assert.equal(canManageDepartments(orgManagerRole), true);
  assert.equal(canReadTemplates(systemConfigRole), true);
  assert.equal(canManageTemplates(systemConfigRole), true);
  assert.equal(canReadDictionaries(systemConfigRole), true);
  assert.equal(canManageDictionaries(systemConfigRole), true);
  assert.equal(canReadGlobalRules(systemConfigRole), true);
  assert.equal(canManageGlobalRules(systemConfigRole), true);
  assert.equal(canReadLogs(systemConfigRole), true);
  assert.equal(canManageLogs(systemConfigRole), true);
  assert.equal(canReadAsyncTasks(systemConfigRole), true);
  assert.equal(canManageAsyncTasks(systemConfigRole), true);
  assert.equal(canReadAudit(auditAndLightRole), true);
  assert.equal(canManageAudit(auditAndLightRole), true);
  assert.equal(canReadLights(auditAndLightRole), true);
  assert.equal(canManageLights(auditAndLightRole), true);
  assert.equal(canReadActivities(ownerRole), true);
  assert.equal(canManageActivities(adminRole), true);

  assert.equal(canReadDepartments(ownerRole), true);
  assert.equal(canReadUsers(ownerRole), true);
  assert.equal(canManageDepartments(ownerRole), false);
  assert.equal(canReadTemplates(ownerRole), false);
  assert.equal(canManageTemplates(ownerRole), false);
  assert.equal(canReadDictionaries(ownerRole), false);
  assert.equal(canManageDictionaries(ownerRole), false);
  assert.equal(canReadAudit(ownerRole), false);
  assert.equal(canManageAudit(ownerRole), false);
  assert.equal(canReadAsyncTasks(ownerRole), false);
  assert.equal(canManageAsyncTasks(ownerRole), false);
  assert.equal(canReadLights(ownerRole), false);
  assert.equal(canManageLights(ownerRole), false);
  assert.equal(canReadGlobalRules(ownerRole), false);
  assert.equal(canManageGlobalRules(ownerRole), false);
  assert.equal(canReadLogs(ownerRole), false);
  assert.equal(canManageLogs(ownerRole), false);
  assert.equal(canManageActivities(ownerRole), false);
});

test('canReadUsers allows workbench and item-capable roles to fetch constrained people directories', () => {
  assert.equal(canReadUsers(ownerRole), true);
  assert.equal(canReadUsers(messageRole), false);
  assert.equal(canReadUsers({ permissions: ['MENU_ITEMS'] }), true);
  assert.equal(canReadUsers({ permissions: ['MENU_WORKBENCH'] }), true);
  assert.equal(canReadUsers({ permissions: ['MENU_MONITORING'] }), false);
});

test('getMessageTargetIdentities resolves ids and names from receiverId/senderId', () => {
  const users = [
    { id: '2', name: '李承办', username: 'owner' },
    { id: '3', name: '王跟进', username: 'follower' },
  ];

  assert.deepEqual(
    getMessageTargetIdentities(
      { receiverId: '2', senderId: '3' },
      users,
    ),
    {
      receiverId: '2',
      receiverName: '李承办',
      senderId: '3',
      senderName: '王跟进',
    },
  );
});

test('getMessageTargetIdentities can backfill ids from legacy receiverName and senderName', () => {
  const users = [
    { id: '2', name: '李承办', username: 'owner' },
    { id: '3', name: '王跟进', username: 'follower' },
  ];

  assert.deepEqual(
    getMessageTargetIdentities(
      { receiverName: '李承办', senderName: 'follower' },
      users,
    ),
    {
      receiverId: '2',
      receiverName: '李承办',
      senderId: '3',
      senderName: '王跟进',
    },
  );
});

test('getMessageTargetIdentities keeps explicit ids as the primary route even when names mismatch', () => {
  const users = [
    { id: '2', name: '李承办', username: 'owner' },
    { id: '3', name: '王跟进', username: 'follower' },
  ];

  assert.deepEqual(
    getMessageTargetIdentities(
      {
        receiverId: 'external-user-id',
        receiverName: '李承办',
        senderId: 'external-sender-id',
        senderName: '王跟进',
      },
      users,
    ),
    {
      receiverId: 'external-user-id',
      receiverName: '李承办',
      senderId: 'external-sender-id',
      senderName: '王跟进',
    },
  );
});

test('message and urge visibility prefer ids and keep legacy name fallback', () => {
  const currentUser = { id: '2', name: '李承办' };

  assert.equal(
    isMessageVisibleToUser(
      { receiverId: '2', receiverName: '他人', senderId: '3' },
      currentUser,
    ),
    true,
  );

  assert.equal(
    isMessageVisibleToUser(
      { receiverName: '李承办' },
      currentUser,
    ),
    true,
  );

  assert.equal(
    isUrgeVisibleToUser(
      { receiverId: '2', senderId: '3' },
      currentUser,
    ),
    true,
  );

  assert.equal(
    isUrgeVisibleToUser(
      { receiverName: '李承办', senderName: '王跟进' },
      currentUser,
    ),
    true,
  );
});
