import test from 'node:test';
import assert from 'node:assert/strict';

import { getBuiltInRoleUpdates, getMissingRolesToCreate, mapRemoteRoleToRole } from './roles.sync';

test('getMissingRolesToCreate returns all local roles when backend is empty', () => {
  const localRoles = [
    { id: 'r1', name: '系统管理员' },
    { id: 'r2', name: '督办专员' },
  ];

  assert.deepEqual(getMissingRolesToCreate(localRoles, []), localRoles);
});

test('getMissingRolesToCreate only returns roles missing from backend', () => {
  const localRoles = [
    { id: 'r1', name: '系统管理员' },
    { id: 'r2', name: '督办专员' },
    { id: 'r3', name: '部门负责人' },
  ];

  const remoteRoles = [
    { id: 'r1', name: '系统管理员' },
    { id: 'r3', name: '部门负责人' },
  ];

  assert.deepEqual(getMissingRolesToCreate(localRoles, remoteRoles), [
    { id: 'r2', name: '督办专员' },
  ]);
});

test('getBuiltInRoleUpdates returns stale built-in roles that need to be corrected', () => {
  const localRoles = [
    {
      id: 'r3',
      name: '部门管理员',
      authCodes: ['MENU_WORKBENCH', 'MENU_ITEMS', 'MENU_MESSAGES'],
      dataScope: 'DEPT',
      followerDataScope: 'DEPT',
      allowedActions: ['READ', 'SEARCH', 'EXPORT'],
    },
    {
      id: 'r5',
      name: '组织管理员',
      authCodes: ['MENU_WORKBENCH', 'MENU_ITEMS', 'MENU_MESSAGES', 'MENU_MONITORING', 'MENU_STATISTICS', 'MENU_RECYCLE_BIN'],
      dataScope: 'MULTI_ORG',
      followerDataScope: 'MULTI_ORG',
      allowedActions: ['READ', 'SEARCH', 'EXPORT', 'CREATE_ITEM', 'DELETE_ITEM'],
    },
  ];

  const remoteRoles = [
    {
      id: 'r3',
      name: '部门管理员',
      permissions: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MESSAGES'],
      dataScope: 'SELF_AND_DIRECT_SUBORDINATES',
      followerDataScope: 'SELF_AND_DIRECT_SUBORDINATES',
      allowedActions: ['READ', 'SEARCH', 'EXPORT'],
    },
    {
      id: 'r5',
      name: '组织管理员',
      permissions: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MESSAGES', 'MENU_MONITORING', 'MENU_STATISTICS'],
      dataScope: 'MULTI_ORG',
      followerDataScope: 'MULTI_ORG',
      allowedActions: ['READ', 'SEARCH', 'EXPORT'],
    },
  ];

  assert.deepEqual(getBuiltInRoleUpdates(localRoles, remoteRoles), [
    {
      id: 'r3',
      authCodes: ['MENU_WORKBENCH', 'MENU_ITEMS', 'MENU_MESSAGES'],
      dataScope: 'DEPT',
      followerDataScope: 'DEPT',
      allowedActions: ['READ', 'SEARCH', 'EXPORT'],
    },
    {
      id: 'r5',
      authCodes: ['MENU_WORKBENCH', 'MENU_ITEMS', 'MENU_MESSAGES', 'MENU_MONITORING', 'MENU_STATISTICS', 'MENU_RECYCLE_BIN'],
      dataScope: 'MULTI_ORG',
      followerDataScope: 'MULTI_ORG',
      allowedActions: ['READ', 'SEARCH', 'EXPORT', 'CREATE_ITEM', 'DELETE_ITEM'],
    },
  ]);
});

test('mapRemoteRoleToRole preserves explicit empty allowedActions from backend', () => {
  assert.deepEqual(
    mapRemoteRoleToRole(
      {
        id: 'r3',
        name: '部门管理员',
        permissions: ['MENU_WORKBENCH'],
        dataScope: 'DEPT',
        followerDataScope: 'DEPT',
        allowedActions: [],
      },
      {
        id: 'r3',
        name: '部门管理员',
        authCodes: ['MENU_WORKBENCH', 'MENU_ITEMS'],
        dataScope: 'SELF',
        allowedActions: ['READ', 'SEARCH', 'EXPORT'],
      },
    ).allowedActions,
    [],
  );
});

test('mapRemoteRoleToRole preserves explicit allowedPageActions from backend', () => {
  const role = mapRemoteRoleToRole({
    id: 'r-page',
    name: '页面权限',
    permissions: ['MENU_ITEMS', 'MENU_STATISTICS'],
    dataScope: 'SELF',
    allowedActions: ['READ', 'SEARCH'],
    allowedPageActions: { MENU_ITEMS: ['EXPORT'] },
  });

  assert.deepEqual(role.allowedPageActions, { MENU_ITEMS: ['EXPORT'] });
});

test('mapRemoteRoleToRole drops scalar page action values', () => {
  const role = mapRemoteRoleToRole({
    id: 'r-page-scalars',
    name: '页面权限标量值',
    permissions: ['MENU_ITEMS', 'MENU_STATISTICS'],
    dataScope: 'SELF',
    allowedPageActions: {
      MENU_ITEMS: 'EXPORT',
      MENU_STATISTICS: ['EXPORT'],
    },
  });

  assert.deepEqual(role.allowedPageActions, { MENU_STATISTICS: ['EXPORT'] });
});

test('mapRemoteRoleToRole parses top-level JSON page actions with array values', () => {
  const role = mapRemoteRoleToRole({
    id: 'r-page-json',
    name: '页面权限 JSON',
    permissions: ['MENU_ITEMS'],
    dataScope: 'SELF',
    allowedPageActions: JSON.stringify({ MENU_ITEMS: ['EXPORT'] }),
  });

  assert.deepEqual(role.allowedPageActions, { MENU_ITEMS: ['EXPORT'] });
});
