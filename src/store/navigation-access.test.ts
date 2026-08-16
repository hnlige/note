import test from 'node:test';
import assert from 'node:assert/strict';

import { canAccessMyItems } from './navigation-access.ts';
import { Role } from '../types';

const roles: Role[] = [
  {
    id: 'r1',
    name: '超级管理员',
    authCodes: ['ALL'],
    dataScope: 'ALL',
    followerDataScope: 'ALL',
    allowedActions: ['READ', 'SEARCH', 'EXPORT', 'CREATE_ITEM'],
  },
  {
    id: 'r2',
    name: '督办跟进人',
    authCodes: ['MENU_WORKBENCH', 'MENU_ITEMS', 'MENU_MY_ITEMS'],
    dataScope: 'SELF',
    followerDataScope: 'SELF',
    allowedActions: ['READ', 'SEARCH', 'URGE_ITEM'],
  },
  {
    id: 'r3',
    name: '部门管理员',
    authCodes: ['MENU_WORKBENCH', 'MENU_ITEMS', 'MENU_MY_ITEMS'],
    dataScope: 'DEPT',
    followerDataScope: 'DEPT',
    allowedActions: ['READ', 'SEARCH', 'EXPORT'],
  },
  {
    id: 'r5',
    name: '组织管理员',
    authCodes: ['MENU_WORKBENCH', 'MENU_ITEMS', 'MENU_MESSAGES', 'MENU_MY_ITEMS'],
    dataScope: 'MULTI_ORG',
    followerDataScope: 'MULTI_ORG',
    allowedActions: ['READ', 'SEARCH', 'EXPORT', 'CREATE_ITEM', 'URGE_ITEM'],
  },
  {
    id: 'r6',
    name: '责任人',
    authCodes: ['MENU_WORKBENCH', 'MENU_ITEMS', 'MENU_MY_ITEMS'],
    dataScope: 'SELF',
    allowedActions: ['READ', 'SEARCH', 'SIGN_ITEM', 'FEEDBACK_ITEM'],
  },
];

test('canAccessMyItems allows configured self and management scoped roles', () => {
  assert.equal(canAccessMyItems({ roleId: 'r1' }, roles), true);
  assert.equal(canAccessMyItems({ roleId: 'r2' }, roles), true);
  assert.equal(canAccessMyItems({ roleId: 'r3' }, roles), true);
  assert.equal(canAccessMyItems({ roleId: 'r5' }, roles), true);
  assert.equal(canAccessMyItems({ roleId: 'r6' }, roles), true);
});

test('canAccessMyItems still blocks roles without menu permission', () => {
  assert.equal(canAccessMyItems({ roleId: 'unknown' }, roles), false);
  assert.equal(canAccessMyItems({ roleIds: ['missing'] }, roles), false);
});
