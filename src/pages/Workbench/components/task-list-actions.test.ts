import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { Role } from '../../../types';
import { getUserSubTaskForIdentity } from '../../../lib/item-format';

const roles: Role[] = [
  {
    id: 'page-sign',
    name: '页面签收',
    authCodes: ['MENU_WORKBENCH'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
    allowedPageActions: { MENU_WORKBENCH: ['SIGN_ITEM'] },
  },
  {
    id: 'page-feedback',
    name: '页面反馈',
    authCodes: ['MENU_WORKBENCH'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
    allowedPageActions: { MENU_WORKBENCH: ['FEEDBACK_ITEM'] },
  },
  {
    id: 'page-both',
    name: '页面签收反馈',
    authCodes: ['MENU_WORKBENCH'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
    allowedPageActions: { MENU_WORKBENCH: ['SIGN_ITEM', 'FEEDBACK_ITEM'] },
  },
  {
    id: 'legacy-both',
    name: '旧式签收反馈',
    authCodes: ['MENU_WORKBENCH'],
    dataScope: 'SELF',
    allowedActions: ['READ', 'SIGN_ITEM', 'FEEDBACK_ITEM'],
  },
  {
    id: 'none',
    name: '无动作',
    authCodes: ['MENU_WORKBENCH'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
  },
];

async function loadVisibility() {
  const modulePath = './task-list-actions';
  const taskListActions = await import(modulePath).catch(() => ({}));
  return (taskListActions as {
    getWorkbenchRowActionVisibility?: (
      roleKind: string,
      user: { role: string; roleId: string },
      roles: Role[],
      status: string,
    ) => { canSign: boolean; canFeedback: boolean };
  }).getWorkbenchRowActionVisibility;
}

test('row action visibility keeps Workbench sign and feedback independent', async () => {
  const getVisibility = await loadVisibility();

  assert.equal(typeof getVisibility, 'function');
  // 签收前(PENDING)：有签收权限出现「签收」、无反馈权限不出现「反馈」
  assert.deepEqual(getVisibility?.('OWNER', { role: 'OWNER', roleId: 'page-sign' }, roles, 'PENDING'), { canSign: true, canFeedback: false });
  // 仅反馈权限、未签收：既不签收也不反馈（反馈须在签收后）
  assert.deepEqual(getVisibility?.('OWNER', { role: 'OWNER', roleId: 'page-feedback' }, roles, 'PENDING'), { canSign: false, canFeedback: false });
  // 仅反馈权限、已签收(EXECUTING)：反馈可见
  assert.deepEqual(getVisibility?.('OWNER', { role: 'OWNER', roleId: 'page-feedback' }, roles, 'EXECUTING'), { canSign: false, canFeedback: true });
  // 双权限、未签收：仅签收可见，反馈隐藏（核心修复点）
  assert.deepEqual(getVisibility?.('OWNER', { role: 'OWNER', roleId: 'page-both' }, roles, 'PENDING'), { canSign: true, canFeedback: false });
  // 双权限、已签收：签收隐藏、反馈可见
  assert.deepEqual(getVisibility?.('OWNER', { role: 'OWNER', roleId: 'page-both' }, roles, 'EXECUTING'), { canSign: false, canFeedback: true });
  // 无任何动作权限：均隐藏
  assert.deepEqual(getVisibility?.('OWNER', { role: 'OWNER', roleId: 'none' }, roles, 'PENDING'), { canSign: false, canFeedback: false });
});

test('row action visibility preserves legacy grants and owner/follower/status rules', async () => {
  const getVisibility = await loadVisibility();

  assert.equal(typeof getVisibility, 'function');
  // 旧式角色(allowedActions 含 SIGN_ITEM/FEEDBACK_ITEM)、未签收：仅签收可见、反馈隐藏
  assert.deepEqual(getVisibility?.('OWNER', { role: 'OWNER', roleId: 'legacy-both' }, roles, 'PENDING'), { canSign: true, canFeedback: false });
  // 跟进人视图（即使拥有 SIGN 权限）也不得出现签收/反馈按钮
  assert.deepEqual(getVisibility?.('FOLLOWER', { role: 'FOLLOWER', roleId: 'page-both' }, roles, 'PENDING'), { canSign: false, canFeedback: false });
  // 仅签收权限、已签收：反馈不可见
  assert.deepEqual(getVisibility?.('OWNER', { role: 'OWNER', roleId: 'page-sign' }, roles, 'EXECUTING'), { canSign: false, canFeedback: false });
});

test('row action visibility hides feedback when owner subtask is overdue', async () => {
  const getVisibility = await loadVisibility();

  assert.equal(typeof getVisibility, 'function');
  // 仅反馈权限、子任务已超时：反馈隐藏
  assert.deepEqual(getVisibility?.('OWNER', { role: 'OWNER', roleId: 'page-feedback' }, roles, 'OVERDUE'), { canSign: false, canFeedback: false });
  // 双权限、子任务已超时：签收已不可能（非 PENDING），反馈也隐藏
  assert.deepEqual(getVisibility?.('OWNER', { role: 'OWNER', roleId: 'page-both' }, roles, 'OVERDUE'), { canSign: false, canFeedback: false });
  // DELAYED 状态仍可反馈（仅验证本次改动未误伤）
  assert.deepEqual(getVisibility?.('OWNER', { role: 'OWNER', roleId: 'page-feedback' }, roles, 'DELAYED'), { canSign: false, canFeedback: true });
});

test('multi-owner feedback visibility is independent per owner (one owner signing does not unlock feedback for others)', async () => {
  const getVisibility = await loadVisibility();
  assert.equal(typeof getVisibility, 'function');

  // 双责任人：甲已签收(子任务 EXECUTING)、乙未签收(子任务 PENDING)
  const multiOwnerItem = {
    id: 'i1',
    status: 'EXECUTING',
    subTasks: [
      { id: 's1', assigneeId: 'A', assigneeName: '甲', status: 'EXECUTING' },
      { id: 's2', assigneeId: 'B', assigneeName: '乙', status: 'PENDING' },
    ],
  } as unknown as import('../../../types').SupervisionItem;

  const userA = { id: 'A', name: '甲', username: 'a', role: 'OWNER', roleId: 'page-both' };
  const userB = { id: 'B', name: '乙', username: 'b', role: 'OWNER', roleId: 'page-both' };

  // 甲本人子任务 EXECUTING（已签收）→ 可反馈、不可签收
  const statusA = getUserSubTaskForIdentity(multiOwnerItem, userA)?.status ?? 'PENDING';
  assert.equal(statusA, 'EXECUTING');
  assert.deepEqual(getVisibility?.('OWNER', userA, roles, statusA), { canSign: false, canFeedback: true });

  // 乙本人子任务 PENDING（未签收）→ 可签收、不可反馈；甲的签收不改变乙的判定
  const statusB = getUserSubTaskForIdentity(multiOwnerItem, userB)?.status ?? 'PENDING';
  assert.equal(statusB, 'PENDING');
  assert.deepEqual(getVisibility?.('OWNER', userB, roles, statusB), { canSign: true, canFeedback: false });
});

test('TaskList renders exact Workbench row controls from the visibility helper', async () => {
  const source = await readFile(new URL('./TaskList.tsx', import.meta.url), 'utf8');

  assert.match(source, /getWorkbenchRowActionVisibility\(\s*rowRoleKind,\s*currentUser,\s*roles,\s*perOwnerStatus\s*\)/);
  assert.match(source, /canSign\s*&&[\s\S]*?>\s*签收\s*</);
  assert.match(source, /canFeedback\s*&&[\s\S]*?>\s*反馈\s*</);
});
