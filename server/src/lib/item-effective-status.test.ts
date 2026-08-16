import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateSubTaskStatus,
  derivePersistedItemStatus,
  getEffectiveItemStatus,
  shouldStartPendingItemAfterOwnerActivity,
} from './item-effective-status';

test('待签收或历史超期事项仅由责任人的签收或反馈事件推进为执行中', () => {
  assert.equal(shouldStartPendingItemAfterOwnerActivity('PENDING', ['SIGN']), true);
  assert.equal(shouldStartPendingItemAfterOwnerActivity('PENDING', ['FEEDBACK']), true);
  assert.equal(shouldStartPendingItemAfterOwnerActivity('OVERDUE', ['SIGN']), true);
  assert.equal(shouldStartPendingItemAfterOwnerActivity('OVERDUE', ['FEEDBACK']), true);
  assert.equal(shouldStartPendingItemAfterOwnerActivity('PENDING', ['FOLLOWER_FEEDBACK']), false);
  assert.equal(shouldStartPendingItemAfterOwnerActivity('EXECUTING', ['SIGN']), false);
});

test('多责任人任一子任务签收后父级状态聚合为执行中', () => {
  assert.equal(
    aggregateSubTaskStatus([
      { assigneeId: 'owner-a', status: 'EXECUTING' },
      { assigneeId: 'owner-b', status: 'PENDING' },
    ]),
    'EXECUTING',
  );
});

test('单责任人无子任务签收后由后端权威函数持久化为执行中', () => {
  const persistedStatus = derivePersistedItemStatus({
    currentStatus: 'PENDING',
    requestedStatus: 'PENDING',
    ownerActivityTimelineTypes: ['SIGN'],
  });

  assert.equal(persistedStatus, 'EXECUTING');
  assert.equal(
    getEffectiveItemStatus({ status: persistedStatus, timeline: [] } as any),
    persistedStatus,
  );
});

test('历史超期事项签收后可恢复执行中，读取口径同步一致', () => {
  assert.equal(
    derivePersistedItemStatus({
      currentStatus: 'OVERDUE',
      requestedStatus: 'OVERDUE',
      ownerActivityTimelineTypes: ['SIGN'],
    }),
    'EXECUTING',
  );
  assert.equal(
    getEffectiveItemStatus({ status: 'OVERDUE', timeline: [{ type: 'SIGN' }] } as any),
    'EXECUTING',
  );
});

test('跟进人反馈不能将单责任人待签收事项推进为执行中', () => {
  assert.equal(
    derivePersistedItemStatus({
      currentStatus: 'PENDING',
      ownerActivityTimelineTypes: ['FOLLOWER_FEEDBACK'],
    }),
    'PENDING',
  );
  assert.equal(
    getEffectiveItemStatus({
      status: 'PENDING',
      timeline: [{ type: 'FOLLOWER_FEEDBACK', content: '跟进反馈了进度' }],
    } as any),
    'PENDING',
  );
});

test('有子任务时父事项通常按后端聚合，明确终态优先于聚合', () => {
  const subTasks = [
    { assigneeId: 'owner-a', status: 'EXECUTING' },
    { assigneeId: 'owner-b', status: 'PENDING' },
  ] as any;
  assert.equal(
    derivePersistedItemStatus({
      currentStatus: 'PENDING',
      requestedStatus: 'PENDING',
      subTasks,
      ownerActivityTimelineTypes: ['SIGN'],
    }),
    'EXECUTING',
  );
  assert.equal(
    derivePersistedItemStatus({
      currentStatus: 'REVIEWING',
      requestedStatus: 'COMPLETED',
      subTasks,
    }),
    'COMPLETED',
  );
  assert.equal(
    derivePersistedItemStatus({
      currentStatus: 'EXECUTING',
      requestedStatus: 'DISABLED',
      subTasks,
    }),
    'DISABLED',
  );
});
