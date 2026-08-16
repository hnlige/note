import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldSyncOrgUsers, shouldSyncRoles } from './bootstrap-sync.ts';
import { Role } from '../types';

const roles: Role[] = [
  {
    id: 'admin',
    name: '系统管理员',
    authCodes: ['ALL'],
    dataScope: 'ALL',
    allowedActions: [],
  },
  {
    id: 'follower',
    name: '督办专员',
    authCodes: ['MENU_MESSAGES', 'MENU_MONITORING'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
  },
  {
    id: 'owner',
    name: '责任人',
    authCodes: ['MENU_ITEMS', 'MENU_MY_ITEMS'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
  },
  {
    id: 'org-admin',
    name: '组织管理员',
    authCodes: ['MENU_ITEMS', 'MENU_MESSAGES'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
  },
  {
    id: 'role-admin',
    name: '角色管理员',
    authCodes: ['MENU_ROLES'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
  },
  {
    id: 'workbench-only',
    name: '工作台协同岗',
    authCodes: ['MENU_WORKBENCH'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
  },
];

test('shouldSyncOrgUsers allows users who need people directory data for item workflows', () => {
  assert.equal(shouldSyncOrgUsers({ roleId: 'admin' }, roles), true);
  assert.equal(shouldSyncOrgUsers({ roleId: 'org-admin' }, roles), true);
  assert.equal(shouldSyncOrgUsers({ roleId: 'owner' }, roles), true);
  assert.equal(shouldSyncOrgUsers({ roleId: 'workbench-only' }, roles), true);
  assert.equal(shouldSyncOrgUsers({ roleId: 'follower' }, roles), false);
  assert.equal(shouldSyncOrgUsers({ roleId: 'missing' }, roles), false);
});

test('shouldSyncRoles only allows users with role management auth', () => {
  assert.equal(shouldSyncRoles({ roleId: 'admin' }, roles), true);
  assert.equal(shouldSyncRoles({ roleId: 'role-admin' }, roles), true);
  assert.equal(shouldSyncRoles({ roleId: 'owner' }, roles), false);
  assert.equal(shouldSyncRoles({ roleId: 'follower' }, roles), false);
  assert.equal(shouldSyncRoles({ roleId: undefined }, roles), false);
});
