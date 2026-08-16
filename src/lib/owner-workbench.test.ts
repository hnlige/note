import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOwnerWorkbenchMetrics, buildOwnerWorkbenchTaskListItems } from './owner-workbench.ts';
import { SupervisionItem, User } from '../types';

const currentUser: User = {
  id: '00000107',
  name: '魏红义',
  username: '00000107',
  role: 'OWNER',
};

const baseItem: SupervisionItem = {
  id: 'item-base',
  serialNo: 'DB-BASE',
  title: '测试事项',
  content: '测试内容',
  status: 'PENDING',
  deadline: '2026-08-31',
  ownerId: 'other-owner',
  ownerName: '其他责任人',
  followerId: 'follower-1',
  followerName: '跟进人',
  progress: 0,
  category: '测试',
  campus: '总部',
  timeline: [],
};

function item(overrides: Partial<SupervisionItem>): SupervisionItem {
  return {
    ...baseItem,
    ...overrides,
    timeline: overrides.timeline ?? [],
    subTasks: overrides.subTasks,
  };
}

test('buildOwnerWorkbenchMetrics counts owner-only todo, overdue, due-soon and on-time completed items', () => {
  const metrics = buildOwnerWorkbenchMetrics([
    item({ id: 'todo-pending', ownerId: '00000107', ownerName: '魏红义', status: 'PENDING', deadline: '2026-08-02' }),
    item({ id: 'todo-executing', ownerId: '00000107', ownerName: '魏红义', status: 'EXECUTING', deadline: '2026-08-03' }),
    item({ id: 'overdue', ownerId: '00000107', ownerName: '魏红义', status: 'OVERDUE', deadline: '2026-07-29' }),
    item({ id: 'due-soon', ownerId: '00000107', ownerName: '魏红义', status: 'EXECUTING', deadline: '2026-08-01' }),
    item({ id: 'completed-on-time', ownerId: '00000107', ownerName: '魏红义', status: 'COMPLETED', deadline: '2026-08-02', actualCompletionDate: '2026-08-01' }),
    item({ id: 'completed-late', ownerId: '00000107', ownerName: '魏红义', status: 'COMPLETED', deadline: '2026-08-01', actualCompletionDate: '2026-08-03' }),
    item({ id: 'other-owner', ownerId: 'other-owner', ownerName: '其他责任人', status: 'OVERDUE', deadline: '2026-07-29' }),
  ], currentUser, '2026-07-31');

  assert.deepEqual(
    metrics.map(metric => [metric.title, metric.value, metric.params]),
    [
      ['我的待办', 4, '?ownerId=me&status=PENDING,EXECUTING,OVERDUE,DELAYED'],
      ['我的超期', 1, '?ownerId=me&status=OVERDUE'],
      ['即将到期', 2, '?ownerId=me&dueSoon=1'],
      ['已按期完成', 1, '?ownerId=me&onTimeCompleted=1'],
    ],
  );
});

test('buildOwnerWorkbenchTaskListItems keeps only current owner todo items and sorts overdue before due soon', () => {
  const rows = buildOwnerWorkbenchTaskListItems([
    item({ id: 'executing-later', ownerId: '00000107', ownerName: '魏红义', status: 'EXECUTING', deadline: '2026-08-08' }),
    item({ id: 'due-soon', ownerId: '00000107', ownerName: '魏红义', status: 'EXECUTING', deadline: '2026-08-01' }),
    item({ id: 'overdue', ownerId: '00000107', ownerName: '魏红义', status: 'OVERDUE', deadline: '2026-07-28' }),
    item({ id: 'completed', ownerId: '00000107', ownerName: '魏红义', status: 'COMPLETED', deadline: '2026-07-30' }),
    item({ id: 'other-owner', ownerId: 'other-owner', ownerName: '其他责任人', status: 'OVERDUE', deadline: '2026-07-28' }),
  ], currentUser, '2026-07-31');

  assert.deepEqual(rows.map(row => row.id), ['overdue', 'due-soon', 'executing-later']);
});
