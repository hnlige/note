import test from 'node:test';
import assert from 'node:assert/strict';

import { Role } from '../../types';

test('detail actions use the exact normalized page context and hide unsupported actions', async () => {
  const detailActions = await import('./detail-actions').catch(() => ({}));
  const canUseDetailPageAction = (detailActions as {
    canUseDetailPageAction?: (user: { roleId: string }, roles: Role[], pageAuth: string, action: string) => boolean;
  }).canUseDetailPageAction;
  const roles: Role[] = [{
    id: 'workbench-sign',
    name: '工作台签收',
    authCodes: ['MENU_WORKBENCH'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
    allowedPageActions: { MENU_WORKBENCH: ['SIGN_ITEM', 'DELETE_ITEM'] },
  }];

  assert.equal(typeof canUseDetailPageAction, 'function');
  assert.equal(canUseDetailPageAction?.({ roleId: 'workbench-sign' }, roles, 'MENU_WORKBENCH', 'SIGN_ITEM'), true);
  assert.equal(canUseDetailPageAction?.({ roleId: 'workbench-sign' }, roles, 'MENU_WORKBENCH', 'FEEDBACK_ITEM'), false);
  assert.equal(canUseDetailPageAction?.({ roleId: 'workbench-sign' }, roles, 'MENU_WORKBENCH', 'DELETE_ITEM'), false);
  assert.equal(canUseDetailPageAction?.({ roleId: 'workbench-sign' }, roles, 'MENU_ITEMS', 'SIGN_ITEM'), false);
});

test('跟进人角色撤销 CHANGE_ITEM 后详情页各入口均不放行变更，反馈仍可用', async () => {
  // 复现「角色配置取消变更按钮但跟进人详情页仍显示」：详情页按钮按来源页面目录判定，
  // 「我的督办」目录本身不含变更；「事项列表」目录含变更但角色全局授权已无 CHANGE_ITEM。
  const detailActions = await import('./detail-actions').catch(() => ({}));
  const canUseDetailPageAction = (detailActions as {
    canUseDetailPageAction?: (user: { roleId: string }, roles: Role[], pageAuth: string, action: string) => boolean;
  }).canUseDetailPageAction;
  const roles: Role[] = [{
    id: 'r2',
    name: '督办跟进人',
    authCodes: ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_MONITORING', 'MENU_STATISTICS', 'MENU_MESSAGES', 'MENU_RECYCLE_BIN'],
    dataScope: 'SELF',
    followerDataScope: 'SELF',
    allowedActions: ['READ', 'SEARCH', 'EXPORT', 'EDIT_ITEM', 'CREATE_ITEM', 'DELETE_ITEM', 'URGE_ITEM', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'SUSPEND_ITEM', 'RESTART_ITEM', 'DISABLE_ITEM', 'REJECT_ITEM', 'APPROVE_ITEM', 'APPLY_COMPLETE_ITEM', 'MARK_UNSATISFIED_ITEM', 'SHARE_ITEM'],
  }];

  assert.equal(canUseDetailPageAction?.({ roleId: 'r2' }, roles, 'MENU_MY_ITEMS', 'CHANGE_ITEM'), false);
  assert.equal(canUseDetailPageAction?.({ roleId: 'r2' }, roles, 'MENU_ITEMS', 'CHANGE_ITEM'), false);
  assert.equal(canUseDetailPageAction?.({ roleId: 'r2' }, roles, 'MENU_WORKBENCH', 'CHANGE_ITEM'), false);
  // 跟进人反馈（FOLLOWER_FEEDBACK）按 FEEDBACK_ITEM 判定，各入口保持可用
  assert.equal(canUseDetailPageAction?.({ roleId: 'r2' }, roles, 'MENU_MY_ITEMS', 'FEEDBACK_ITEM'), true);
  assert.equal(canUseDetailPageAction?.({ roleId: 'r2' }, roles, 'MENU_ITEMS', 'FEEDBACK_ITEM'), true);
  assert.equal(canUseDetailPageAction?.({ roleId: 'r2' }, roles, 'MENU_WORKBENCH', 'FEEDBACK_ITEM'), true);
});

test('页面级显式取消变更优先于全局 allowedActions 回退（与后端 hasPageAction 口径一致）', async () => {
  const detailActions = await import('./detail-actions').catch(() => ({}));
  const canUseDetailPageAction = (detailActions as {
    canUseDetailPageAction?: (user: { roleId: string }, roles: Role[], pageAuth: string, action: string) => boolean;
  }).canUseDetailPageAction;
  const roles: Role[] = [{
    id: 'custom-follower',
    name: '自定义跟进角色',
    authCodes: ['MENU_ITEMS'],
    dataScope: 'SELF',
    // 全局仍含 CHANGE_ITEM（旧数据），但事项列表页面级配置已取消
    allowedActions: ['READ', 'SEARCH', 'CHANGE_ITEM'],
    allowedPageActions: { MENU_ITEMS: ['READ', 'SEARCH', 'URGE_ITEM'] },
  }];

  assert.equal(canUseDetailPageAction?.({ roleId: 'custom-follower' }, roles, 'MENU_ITEMS', 'CHANGE_ITEM'), false);
  assert.equal(canUseDetailPageAction?.({ roleId: 'custom-follower' }, roles, 'MENU_ITEMS', 'URGE_ITEM'), true);
  // 未配置页面级的页面回退全局授权
  assert.equal(canUseDetailPageAction?.({ roleId: 'custom-follower' }, roles, 'MENU_WORKBENCH', 'CHANGE_ITEM'), true);
});
