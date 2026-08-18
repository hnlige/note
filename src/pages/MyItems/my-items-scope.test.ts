import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMyItemsScope, filterMyItemsByStatus, getTodoStatus, getVisibleMyItemsRoleTabs } from './my-items-scope.ts';
import { SupervisionItem, User } from '../../types';

const currentUser: User = {
  id: 'admin',
  name: '张管理',
  username: 'admin',
  role: 'ADMIN',
};

function item(input: Partial<SupervisionItem> & Pick<SupervisionItem, 'id' | 'status'>): SupervisionItem {
  return {
    id: input.id,
    serialNo: input.id,
    title: input.id,
    content: input.id,
    status: input.status,
    effectiveStatus: input.effectiveStatus,
    deadline: '2026-08-31',
    ownerId: input.ownerId || 'other-owner',
    ownerName: input.ownerName || input.ownerId || '其他责任人',
    ownerIds: input.ownerIds,
    ownerNames: input.ownerNames,
    followerId: input.followerId || 'other-follower',
    followerName: input.followerName || input.followerId || '其他跟进人',
    followerIds: input.followerIds,
    followerNames: input.followerNames,
    progress: input.progress || 0,
    category: '测试',
    campus: '测试',
    timeline: input.timeline || [],
    subTasks: input.subTasks,
  };
}

test('buildMyItemsScope counts only current user owner and follower relations for all roles', () => {
  const scope = buildMyItemsScope([
    item({ id: 'own-pending', status: 'PENDING', ownerId: 'admin' }),
    item({ id: 'own-secondary', status: 'EXECUTING', ownerId: 'someone', ownerIds: ['admin'] }),
    item({ id: 'own-subtask-delayed', status: 'EXECUTING', ownerId: 'someone', subTasks: [{ id: 'st1', title: '子任务', deadline: '2026-08-31', assigneeId: 'admin', status: 'DELAYED' }] }),
    item({ id: 'own-completed', status: 'COMPLETED', ownerId: 'admin' }),
    item({ id: 'own-archived', status: 'ARCHIVED', ownerId: 'admin' }),
    item({ id: 'dept-visible-owner', status: 'OVERDUE', ownerId: 'child-owner' }),
    item({ id: 'follow-overdue', status: 'OVERDUE', followerId: 'admin' }),
    item({ id: 'follow-secondary', status: 'DELAYED', followerId: 'someone', followerIds: ['admin'] }),
    item({ id: 'dept-visible-follower', status: 'PENDING', followerId: 'child-follower' }),
    item({ id: 'deleted-own', status: 'DELETED', ownerId: 'admin' }),
  ], currentUser);

  assert.deepEqual(scope.ownedItems.map(row => row.id), [
    'own-pending',
    'own-secondary',
    'own-subtask-delayed',
    'own-completed',
    'own-archived',
  ]);
  assert.deepEqual(scope.followedItems.map(row => row.id), ['follow-overdue', 'follow-secondary']);
  assert.deepEqual(scope.todoItems.map(row => row.id), [
    'own-pending',
    'own-secondary',
    'own-subtask-delayed',
    'follow-overdue',
    'follow-secondary',
  ]);

  assert.deepEqual(scope.ownerStatusCounts, {
    all: 5,
    PENDING: 1,
    EXECUTING: 1,
    OVERDUE: 0,
    DELAYED: 1,
    COMPLETED: 1,
  });
  assert.deepEqual(scope.followerStatusCounts, {
    all: 2,
    PENDING: 0,
    EXECUTING: 0,
    OVERDUE: 1,
    DELAYED: 1,
    COMPLETED: 0,
  });
  assert.equal(scope.todoStatusCounts.PENDING, 1);
  assert.equal(scope.todoStatusCounts.OVERDUE, 1);
});

test('filterMyItemsByStatus uses owner-specific effective status and follower effective item status', () => {
  const ownedItems = [
    item({
      id: 'owner-overdue-subtask',
      status: 'EXECUTING',
      ownerId: 'admin',
      subTasks: [
        { id: 'st1', title: '本人子任务', deadline: '2026-08-31', assigneeId: 'admin', status: 'OVERDUE' },
        { id: 'st2', title: '其他子任务', deadline: '2026-08-31', assigneeId: 'someone', status: 'COMPLETED' },
      ],
    }),
    item({ id: 'owner-completed', status: 'COMPLETED', ownerId: 'admin' }),
  ];
  const followedItems = [
    item({
      id: 'follow-aggregate-overdue',
      status: 'EXECUTING',
      effectiveStatus: 'OVERDUE',
      followerId: 'admin',
      subTasks: [
        { id: 'st1', title: '其他子任务', deadline: '2026-08-31', assigneeId: 'someone', status: 'OVERDUE' },
      ],
    }),
  ];

  assert.deepEqual(filterMyItemsByStatus(ownedItems, currentUser, 'owner', 'OVERDUE').map(row => row.id), ['owner-overdue-subtask']);
  assert.deepEqual(filterMyItemsByStatus(ownedItems, currentUser, 'owner', 'COMPLETED').map(row => row.id), ['owner-completed']);
  assert.deepEqual(filterMyItemsByStatus(followedItems, currentUser, 'follower', 'OVERDUE').map(row => row.id), ['follow-aggregate-overdue']);
});

test('getVisibleMyItemsRoleTabs maps role type to expected top-level tabs', () => {
  // 超级管理员 / 督办管理员（ADMIN）：我的待办 + 我负责的督办 + 我跟进的督办
  assert.deepEqual(getVisibleMyItemsRoleTabs('ADMIN'), ['todo', 'owner', 'follower']);
  // 督办责任人（OWNER）：我的待办 + 我负责的督办（无跟进视角）
  assert.deepEqual(getVisibleMyItemsRoleTabs('OWNER'), ['todo', 'owner']);
  // 督办跟进人（FOLLOWER）：我的待办 + 我跟进的督办（无负责视角）
  assert.deepEqual(getVisibleMyItemsRoleTabs('FOLLOWER'), ['todo', 'follower']);
});

// 纯跟进人（如贺诗然 r2，不负责任何事项、只跟进）的工作台「我的待办任务」
// 必须纳入其作为跟进人的事项，与首页卡片口径一致；这是 TaskList owner 模式 follower 分叉的核心依赖。
test('buildMyItemsScope: 纯跟进人 todoItems 纳入其跟进的非完成事项，排除完成/归档/禁用/删除', () => {
  const follower: User = { id: 'follower-h', name: '贺诗然', username: '00003026', role: 'FOLLOWER' };
  const scope = buildMyItemsScope([
    // 跟进人视角：事项整体状态决定是否待办
    item({ id: 'follow-pending', status: 'PENDING', followerId: 'follower-h' }),
    item({ id: 'follow-executing', status: 'EXECUTING', followerId: 'follower-h' }),
    item({ id: 'follow-overdue', status: 'OVERDUE', followerId: 'follower-h' }),
    item({ id: 'follow-delayed', status: 'DELAYED', followerId: 'follower-h' }),
    item({ id: 'follow-suspended', status: 'SUSPENDED', followerId: 'follower-h' }),
    item({ id: 'follow-completed', status: 'COMPLETED', followerId: 'follower-h' }),
    item({ id: 'follow-archived', status: 'ARCHIVED', followerId: 'follower-h' }),
    item({ id: 'follow-disabled', status: 'DISABLED', followerId: 'follower-h' }),
    item({ id: 'follow-deleted', status: 'DELETED', followerId: 'follower-h' }),
    // 非本人跟进的事项不应计入
    item({ id: 'other-pending', status: 'PENDING', followerId: 'someone-else' }),
  ], follower);

  // ownedItems 应为空（纯跟进人不负责任何事项）
  assert.deepEqual(scope.ownedItems.map(row => row.id), []);
  // followedItems 应包含所有非删除的跟进事项
  assert.deepEqual(scope.followedItems.map(row => row.id), [
    'follow-pending', 'follow-executing', 'follow-overdue',
    'follow-delayed', 'follow-suspended', 'follow-completed', 'follow-archived', 'follow-disabled',
  ]);
  // todoItems 应排除 COMPLETED/ARCHIVED/DISABLED/DELETED，保留待办状态
  assert.deepEqual(scope.todoItems.map(row => row.id), [
    'follow-pending', 'follow-executing', 'follow-overdue',
    'follow-delayed', 'follow-suspended',
  ]);
  // getTodoStatus 对纯跟进人应返回事项整体状态
  assert.equal(getTodoStatus(scope.followedItems[0], follower), 'PENDING');
  assert.equal(getTodoStatus(scope.followedItems[2], follower), 'OVERDUE');
  assert.equal(getTodoStatus(scope.followedItems[4], follower), 'SUSPENDED');
});
