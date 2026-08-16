import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asStringArray,
  computeReassignUpdate,
  detectReassignConflicts,
  matchItems,
  type ReassignScope,
  type ReassignUserLike,
} from './reassign-core';

const fromUser: ReassignUserLike = { id: 'u-from', name: '小张' };
const toUser: ReassignUserLike = { id: 'u-to', name: '小李' };
const otherUser: ReassignUserLike = { id: 'u-other', name: '小王' };

test('asStringArray 兼容数组与历史字符串化存储', () => {
  assert.deepEqual(asStringArray(['a', 'b']), ['a', 'b']);
  assert.deepEqual(asStringArray('["a","b"]'), ['a', 'b']);
  assert.deepEqual(asStringArray('a'), ['a']);
  assert.deepEqual(asStringArray(null), []);
  assert.deepEqual(asStringArray(undefined), []);
});

test('matchItems 按 scope 筛选命中事项', () => {
  const items = [
    { id: 'i1', ownerId: 'u-from', ownerIds: ['u-from'], followerId: 'x', followerIds: ['x'], serialNo: 'DB-001' },
    { id: 'i2', ownerId: 'x', ownerIds: ['x'], followerId: 'u-from', followerIds: ['u-from'], serialNo: 'DB-002' },
    { id: 'i3', ownerId: 'x', ownerIds: ['x'], followerId: 'y', followerIds: ['y'], serialNo: 'DB-003' },
    { id: 'i4', deletedAt: new Date(), ownerId: 'u-from', ownerIds: ['u-from'], serialNo: 'DB-004' },
  ];
  assert.deepEqual(matchItems(items, fromUser, 'OWNER').map((i) => i.id), ['i1']);
  assert.deepEqual(matchItems(items, fromUser, 'FOLLOWER').map((i) => i.id), ['i2']);
  assert.deepEqual(matchItems(items, fromUser, 'ALL').map((i) => i.id), ['i1', 'i2']);
  // 已删除事项被排除
  assert.ok(!matchItems(items, fromUser, 'OWNER').some((i) => i.id === 'i4'));
});

test('computeReassignUpdate 多责任人：只换身份，状态/进度/子任务状态全部保留', () => {
  const item = {
    id: 'i1',
    ownerId: 'u-from',
    ownerName: '小张',
    ownerIds: ['u-from', 'u-other'],
    ownerNames: ['小张', '小王'],
    status: 'EXECUTING',
    subTasks: [
      { id: 's1', assigneeId: 'u-from', assigneeName: '小张', status: 'EXECUTING', progress: 60, deadline: '2026-09-01' },
      { id: 's2', assigneeId: 'u-other', assigneeName: '小王', status: 'PENDING', progress: 0 },
    ],
  };
  const { update, didOwner } = computeReassignUpdate(item, fromUser, toUser, 'OWNER');
  assert.equal(didOwner, true);
  // 单字段与数组同步替换
  assert.equal(update.ownerId, 'u-to');
  assert.equal(update.ownerName, '小李');
  assert.deepEqual(update.ownerIds, ['u-to', 'u-other']);
  assert.deepEqual(update.ownerNames, ['小李', '小王']);
  // 父事项状态不动
  assert.equal(update.status, undefined);
  // 子任务只换 assignee 身份，status/progress/deadline 原样保留
  const subTasks = update.subTasks as any[];
  assert.equal(subTasks[0].assigneeId, 'u-to');
  assert.equal(subTasks[0].assigneeName, '小李');
  assert.equal(subTasks[0].status, 'EXECUTING');
  assert.equal(subTasks[0].progress, 60);
  assert.equal(subTasks[0].deadline, '2026-09-01');
  // 另一责任人子任务完全不变
  assert.deepEqual(subTasks[1], item.subTasks[1]);
});

test('computeReassignUpdate FOLLOWER 范围只动跟进人，不动责任人', () => {
  const item = {
    id: 'i2',
    ownerId: 'u-other',
    ownerIds: ['u-other'],
    followerId: 'u-from',
    followerName: '小张',
    followerIds: ['u-from'],
    followerNames: ['小张'],
  };
  const { update, didOwner, didFollower } = computeReassignUpdate(item, fromUser, toUser, 'FOLLOWER');
  assert.equal(didOwner, false);
  assert.equal(didFollower, true);
  assert.equal(update.followerId, 'u-to');
  assert.deepEqual(update.followerIds, ['u-to']);
  // 责任人字段不动
  assert.equal(update.ownerId, undefined);
  assert.equal(update.ownerIds, undefined);
});

test('computeReassignUpdate 旧版单字段存储也能正确替换并保持数组同步', () => {
  const item = {
    id: 'i5',
    ownerId: 'u-from',
    ownerName: '小张',
    ownerIds: null,
    ownerNames: null,
    subTasks: [{ assigneeId: 'u-from', assigneeName: '小张', status: 'PENDING' }],
  };
  const { update } = computeReassignUpdate(item, fromUser, toUser, 'OWNER');
  assert.equal(update.ownerId, 'u-to');
  // 数组同步生成，避免两套口径不一致
  assert.deepEqual(update.ownerIds, ['u-to']);
  assert.deepEqual(update.ownerNames, ['小李']);
  assert.equal((update.subTasks as any[])[0].assigneeId, 'u-to');
  assert.equal((update.subTasks as any[])[0].status, 'PENDING');
});

test('detectReassignConflicts 目标人已是责任人时整体拦截', () => {
  const items = [
    { id: 'i1', ownerId: 'u-from', ownerIds: ['u-from', 'u-to'], serialNo: 'DB-001' },
    { id: 'i2', ownerId: 'u-from', ownerIds: ['u-from'], serialNo: 'DB-002' },
  ];
  const conflicts = detectReassignConflicts(items, toUser, 'OWNER');
  assert.deepEqual(conflicts, ['DB-001']);

  const noConflict = detectReassignConflicts([items[1]], otherUser, 'OWNER');
  assert.deepEqual(noConflict, []);
});

test('detectReassignConflicts ALL 范围：目标人任一角色命中即冲突', () => {
  const items = [
    { id: 'i1', ownerIds: ['u-from'], followerIds: [], serialNo: 'DB-001' },
    { id: 'i2', ownerIds: [], followerIds: ['u-to'], serialNo: 'DB-002' },
  ];
  assert.deepEqual(detectReassignConflicts(items, toUser, 'ALL'), ['DB-002']);
  // 目标人不在任何命中事项中则不冲突
  assert.deepEqual(detectReassignConflicts(items, otherUser, 'ALL'), []);
});
