import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDelayActorSubTasks, getLatestSubTaskPlannedDate, hasDelayTimelineNode, ensureItemActorAllowed } from './items';

test('buildDelayActorSubTasks moves only the applying owner subtask to DELAYED with the new dates', () => {
  const subTasks = [
    { id: 'st-1', assigneeId: 'owner-1', assigneeName: '魏红义', status: 'OVERDUE', plannedCompletionDate: '2026/08/10', deadline: '2026/08/10' },
    { id: 'st-2', assigneeId: 'owner-2', assigneeName: '申林', status: 'OVERDUE', plannedCompletionDate: '2026/08/10', deadline: '2026/08/10' },
  ];

  const next = buildDelayActorSubTasks(subTasks, ['owner-1', '魏红义'], '2026-09-10');

  assert.ok(next);
  assert.equal(next[0]?.status, 'DELAYED');
  assert.equal(next[0]?.plannedCompletionDate, '2026-09-10');
  assert.equal(next[0]?.deadline, '2026-09-10');
  // 其他责任人的子任务保持不变
  assert.equal(next[1]?.status, 'OVERDUE');
  assert.equal(next[1]?.plannedCompletionDate, '2026/08/10');
});

test('buildDelayActorSubTasks matches the actor by name fallback', () => {
  const subTasks = [
    { id: 'st-1', assigneeName: '魏红义', status: 'OVERDUE' },
  ];

  const next = buildDelayActorSubTasks(subTasks, ['魏红义'], '2026-09-10');

  assert.ok(next);
  assert.equal(next[0]?.status, 'DELAYED');
});

test('buildDelayActorSubTasks returns null when the actor owns no subtask', () => {
  const subTasks = [
    { id: 'st-1', assigneeId: 'owner-2', assigneeName: '申林', status: 'OVERDUE' },
  ];

  assert.equal(buildDelayActorSubTasks(subTasks, ['owner-1', '魏红义'], '2026-09-10'), null);
  assert.equal(buildDelayActorSubTasks([], ['owner-1'], '2026-09-10'), null);
  assert.equal(buildDelayActorSubTasks(undefined, ['owner-1'], '2026-09-10'), null);
});

test('hasDelayTimelineNode detects client-provided DELAY nodes only', () => {
  assert.equal(hasDelayTimelineNode([{ type: 'DELAY', content: '申请延期。原因：等待材料' }]), true);
  assert.equal(hasDelayTimelineNode([{ type: 'FEEDBACK', content: '进展反馈' }]), false);
  assert.equal(hasDelayTimelineNode([]), false);
  assert.equal(hasDelayTimelineNode(undefined), false);
});

test('feedback action allows owner whose subtask was moved to DELAYED by the extension', () => {
  const state: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  };
  const accessContext = {
    currentUser: { id: 'owner-1', name: '魏红义', role: 'OWNER', roleId: 'r-owner' },
    currentRole: { permissions: [], allowedActions: ['READ', 'FEEDBACK_ITEM'] },
  };
  const delayedItem = {
    ownerIds: ['owner-1'],
    ownerNames: ['魏红义'],
    subTasks: [
      { id: 'st-1', assigneeId: 'owner-1', assigneeName: '魏红义', status: 'DELAYED', plannedCompletionDate: '2026-09-10', deadline: '2026-09-10' },
    ],
  };

  assert.equal(ensureItemActorAllowed(accessContext as any, 'FEEDBACK_ITEM', delayedItem, response), true);
  assert.equal(state.status, undefined);
});

test('getLatestSubTaskPlannedDate 取全部子任务的最晚计划日期（整体口径）', () => {
  const subTasks = [
    { id: 'st-1', assigneeName: '魏红义', status: 'DELAYED', plannedCompletionDate: '2026-09-28', deadline: '2026-09-28' },
    { id: 'st-2', assigneeName: '申林', status: 'EXECUTING', plannedCompletionDate: '2026-08-31', deadline: '2026-08-31' },
  ];

  const latest = getLatestSubTaskPlannedDate(subTasks);

  assert.ok(latest);
  assert.equal(latest.getFullYear(), 2026);
  assert.equal(latest.getMonth() + 1, 9);
  assert.equal(latest.getDate(), 28);
});

test('getLatestSubTaskPlannedDate 跳过空日期子任务并兼容缺失场景', () => {
  assert.equal(getLatestSubTaskPlannedDate([
    { id: 'st-1', assigneeName: '申林', status: 'PENDING' },
    { id: 'st-2', assigneeName: '魏红义', status: 'DELAYED', plannedCompletionDate: '2026-09-28' },
  ])?.getFullYear(), 2026);
  assert.equal(getLatestSubTaskPlannedDate([]), null);
  assert.equal(getLatestSubTaskPlannedDate(undefined), null);
});
