import test from 'node:test';
import assert from 'node:assert/strict';

import { BUILT_IN_ROLE_BY_ID } from './built-in-roles';

test('built-in admin roles match the intended menu and data-scope baseline', () => {
  assert.equal(Object.keys(BUILT_IN_ROLE_BY_ID).length, 6);

  assert.deepEqual(BUILT_IN_ROLE_BY_ID.r2, {
    id: 'r2',
    name: '督办跟进人',
    description: '跟进人角色，可处理本人相关督办并查看我的督办、催办、台账与消息模块',
    permissions: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MONITORING', 'MENU_STATISTICS', 'MENU_MESSAGES', 'MENU_RECYCLE_BIN'],
    dataScope: 'SELF',
    followerDataScope: 'SELF',
    allowedActions: ['READ', 'SEARCH', 'EXPORT', 'EDIT_ITEM', 'CREATE_ITEM', 'DELETE_ITEM', 'URGE_ITEM', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'CHANGE_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'REJECT_ITEM', 'APPROVE_ITEM', 'APPLY_COMPLETE_ITEM', 'MARK_UNSATISFIED_ITEM', 'SHARE_ITEM'],
  });

  assert.deepEqual(BUILT_IN_ROLE_BY_ID.r3, {
    id: 'r3',
    name: '部门管理员',
    description: '部门负责人角色，可查看本部门范围内的督办事项，并进入我的督办、催办、统计与消息模块',
    permissions: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MONITORING', 'MENU_STATISTICS', 'MENU_MESSAGES'],
    dataScope: 'DEPT',
    followerDataScope: 'DEPT',
    allowedActions: ['READ', 'SEARCH', 'EXPORT'],
  });

  assert.deepEqual(BUILT_IN_ROLE_BY_ID.r4dtsn6m, {
    id: 'r4dtsn6m',
    name: '督办管理员',
    description: '督办业务管理员，拥有全局督办业务管理权限',
    permissions: ['ALL'],
    dataScope: 'ALL',
    followerDataScope: 'ALL',
    allowedActions: ['READ', 'SEARCH', 'EXPORT', 'EDIT_ITEM', 'EDIT_SYSTEM', 'CREATE_ITEM', 'DELETE_ITEM', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM', 'URGE_ITEM', 'CHANGE_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'REJECT_ITEM', 'APPROVE_ITEM', 'APPLY_COMPLETE_ITEM', 'MARK_UNSATISFIED_ITEM', 'SHARE_ITEM'],
  });

  assert.deepEqual(BUILT_IN_ROLE_BY_ID.r5, {
    id: 'r5',
    name: '组织管理员',
    description: '各组织负责人角色，可查看本组织范围内的督办事项，并进入我的督办、回收站等管理模块',
    permissions: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MESSAGES', 'MENU_MONITORING', 'MENU_STATISTICS', 'MENU_RECYCLE_BIN'],
    dataScope: 'MULTI_ORG',
    followerDataScope: 'MULTI_ORG',
    allowedActions: ['READ', 'SEARCH', 'EXPORT', 'CREATE_ITEM', 'DELETE_ITEM', 'URGE_ITEM', 'CHANGE_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'REJECT_ITEM', 'APPROVE_ITEM', 'APPLY_COMPLETE_ITEM', 'MARK_UNSATISFIED_ITEM', 'SHARE_ITEM'],
  });

  assert.deepEqual(BUILT_IN_ROLE_BY_ID.r6, {
    id: 'r6',
    name: '责任人',
    description: '业务经办人角色，仅处理本人负责的督办事项',
    permissions: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MESSAGES'],
    dataScope: 'SELF',
    followerDataScope: null,
    allowedActions: ['READ', 'SEARCH', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM', 'APPLY_COMPLETE_ITEM', 'SHARE_ITEM'],
  });
});
