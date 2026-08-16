import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { getActionBarControls, getActionBarMode } from './action-bar-mode';
import { Role } from '../../../types';

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
    name: '督办专员',
    authCodes: ['MENU_WORKBENCH', 'MENU_ITEMS', 'MENU_MESSAGES', 'MENU_MONITORING'],
    dataScope: 'SELF',
    followerDataScope: 'SELF',
    allowedActions: ['READ', 'SEARCH', 'EXPORT', 'URGE_ITEM'],
  },
  {
    id: 'r5',
    name: '组织管理员',
    authCodes: ['MENU_WORKBENCH', 'MENU_ITEMS', 'MENU_MESSAGES', 'MENU_MONITORING', 'MENU_STATISTICS', 'MENU_RECYCLE_BIN'],
    dataScope: 'MULTI_ORG',
    followerDataScope: 'MULTI_ORG',
    allowedActions: ['READ', 'SEARCH', 'EXPORT', 'CREATE_ITEM', 'URGE_ITEM'],
  },
  {
    id: 'r6',
    name: '责任人',
    authCodes: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MESSAGES'],
    dataScope: 'SELF',
    allowedActions: ['READ', 'SEARCH', 'SIGN_ITEM', 'FEEDBACK_ITEM'],
  },
  {
    id: 'r-export',
    name: '工作台导出角色',
    authCodes: ['MENU_WORKBENCH'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
    allowedPageActions: { MENU_WORKBENCH: ['EXPORT'] },
  },
  {
    id: 'r-sign-page',
    name: '仅工作台签收',
    authCodes: ['MENU_WORKBENCH'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
    allowedPageActions: { MENU_WORKBENCH: ['SIGN_ITEM'] },
  },
  {
    id: 'r-feedback-page',
    name: '仅工作台反馈',
    authCodes: ['MENU_WORKBENCH'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
    allowedPageActions: { MENU_WORKBENCH: ['FEEDBACK_ITEM'] },
  },
  {
    id: 'r-both-page',
    name: '工作台签收反馈',
    authCodes: ['MENU_WORKBENCH'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
    allowedPageActions: { MENU_WORKBENCH: ['SIGN_ITEM', 'FEEDBACK_ITEM'] },
  },
  {
    id: 'r-no-owner-actions',
    name: '无工作台责任人动作',
    authCodes: ['MENU_WORKBENCH'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
  },
  {
    id: 'r-sign-legacy',
    name: '旧式全局签收',
    authCodes: ['MENU_WORKBENCH'],
    dataScope: 'SELF',
    allowedActions: ['READ', 'SIGN_ITEM'],
  },
  {
    id: 'r-follower-template',
    name: '督办跟进人-模板权限',
    authCodes: ['MENU_WORKBENCH', 'MENU_ITEMS', 'MENU_MESSAGES'],
    dataScope: 'SELF',
    followerDataScope: 'SELF',
    allowedActions: ['READ'],
    allowedPageActions: { MENU_WORKBENCH: ['DOWNLOAD_TEMPLATE', 'BATCH_IMPORT'] },
  },
];

test('getActionBarMode honors backend role config instead of the coarse user role mapping', () => {
  assert.equal(
    getActionBarMode({ role: 'OWNER', roleId: 'r5', roleIds: ['r5'] }, roles),
    'admin',
  );

  assert.equal(
    getActionBarMode({ role: 'OWNER', roleId: 'r6', roleIds: ['r6'] }, roles),
    'owner',
  );

  assert.equal(
    getActionBarMode({ role: 'FOLLOWER', roleId: 'r2', roleIds: ['r2'] }, roles),
    'follower',
  );
});

test('getActionBarControls exposes workbench export independently from action bar mode', () => {
  const user = { roleId: 'r-export', roleIds: ['r-export'] };
  assert.equal(getActionBarMode(user, roles), 'none');

  assert.deepEqual(getActionBarControls(user, roles), {
    mode: 'none',
    canSignWorkbench: false,
    canFeedbackWorkbench: false,
    canExportWorkbench: true,
    canCreateItem: false,
    canDownloadTemplate: false,
    canBatchImport: false,
  });
});

test('getActionBarControls exposes sign and feedback independently for page-only grants', () => {
  assert.deepEqual(getActionBarControls({ roleId: 'r-sign-page' }, roles), {
    mode: 'owner',
    canSignWorkbench: true,
    canFeedbackWorkbench: false,
    canExportWorkbench: false,
    canCreateItem: false,
    canDownloadTemplate: false,
    canBatchImport: false,
  });
  assert.deepEqual(getActionBarControls({ roleId: 'r-feedback-page' }, roles), {
    mode: 'owner',
    canSignWorkbench: false,
    canFeedbackWorkbench: true,
    canExportWorkbench: false,
    canCreateItem: false,
    canDownloadTemplate: false,
    canBatchImport: false,
  });
  assert.deepEqual(getActionBarControls({ roleId: 'r-both-page' }, roles), {
    mode: 'owner',
    canSignWorkbench: true,
    canFeedbackWorkbench: true,
    canExportWorkbench: false,
    canCreateItem: false,
    canDownloadTemplate: false,
    canBatchImport: false,
  });
  assert.deepEqual(getActionBarControls({ roleId: 'r-no-owner-actions' }, roles), {
    mode: 'none',
    canSignWorkbench: false,
    canFeedbackWorkbench: false,
    canExportWorkbench: false,
    canCreateItem: false,
    canDownloadTemplate: false,
    canBatchImport: false,
  });
});

test('getActionBarControls preserves legacy global Workbench action grants', () => {
  assert.deepEqual(getActionBarControls({ roleId: 'r-sign-legacy' }, roles), {
    mode: 'owner',
    canSignWorkbench: true,
    canFeedbackWorkbench: false,
    canExportWorkbench: false,
    canCreateItem: false,
    canDownloadTemplate: false,
    canBatchImport: false,
  });
});

test('ActionBar renders bulk sign and feedback from independent controls', async () => {
  const source = await readFile(new URL('./ActionBar.tsx', import.meta.url), 'utf8');

  assert.match(source, /canSignWorkbench\s*&&[\s\S]*?一键签收全部/);
  assert.match(source, /canFeedbackWorkbench\s*&&[\s\S]*?批量反馈/);
});

test('ActionBar renders download-template button gated by canDownloadTemplate', async () => {
  const source = await readFile(new URL('./ActionBar.tsx', import.meta.url), 'utf8');

  // 跟进人勾选“导入模板(DOWNLOAD_TEMPLATE)”后，工作台首页必须渲染该按钮
  assert.match(source, /canDownloadTemplate\s*&&/);
  assert.match(source, /canDownloadTemplate\s*&&[\s\S]*?导入模板/);
});

test('getActionBarControls exposes download-template and batch-import for follower template grant', () => {
  assert.deepEqual(getActionBarControls({ roleId: 'r-follower-template' }, roles), {
    mode: 'none',
    canSignWorkbench: false,
    canFeedbackWorkbench: false,
    canExportWorkbench: false,
    canCreateItem: false,
    canDownloadTemplate: true,
    canBatchImport: true,
  });
});
