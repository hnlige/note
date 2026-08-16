import test from 'node:test';
import assert from 'node:assert/strict';

import { getEffectiveItemStatus, getEffectiveStatusForUserIdentity, getItemSignOffStatus, isItemOwnerForUser } from './item-format.ts';
import { SupervisionItem } from '../types';

const baseItem: SupervisionItem = {
  id: 'item-1',
  serialNo: 'AUTO-001',
  title: 'AUTO-001',
  content: '测试事项',
  status: 'PENDING',
  deadline: '',
  ownerId: 'owner-1',
  ownerName: '责任人',
  followerId: 'follower-1',
  followerName: '跟进人',
  progress: 0,
  category: '',
  campus: '',
  timeline: [],
};

test('getEffectiveItemStatus keeps completed main item final even when a sub task is stale', () => {
  assert.equal(
    getEffectiveItemStatus({
      ...baseItem,
      status: 'COMPLETED',
      subTasks: [
        {
          id: 'sub-1',
          parentItemId: 'item-1',
          title: '子任务',
          deadline: '',
          status: 'REVIEWING',
          assigneeId: 'owner-1',
          assigneeName: '责任人',
          progress: 100,
        },
      ],
    }),
    'COMPLETED',
  );
});

test('getEffectiveItemStatus 不再根据时间轴或子任务在前端重算父事项状态', () => {
  assert.equal(
    getEffectiveItemStatus({
      ...baseItem,
      status: 'PENDING',
      subTasks: [
        {
          id: 'sub-1',
          parentItemId: 'item-1',
          title: '子任务',
          deadline: '',
          status: 'EXECUTING',
          assigneeId: 'owner-1',
          assigneeName: '责任人',
        },
      ],
      timeline: [{ id: 't1', type: 'SIGN', user: '责任人', content: '签收', timestamp: '' }],
    }),
    'PENDING',
  );
});

test('getEffectiveStatusForUser keeps disabled main item final even when owner sub task is executing', () => {
  const item = {
    ...baseItem,
    status: 'DISABLED' as const,
    subTasks: [
      {
        id: 'sub-1',
        parentItemId: 'item-1',
        title: '子任务',
        deadline: '',
        status: 'EXECUTING' as const,
        assigneeId: 'owner-1',
        assigneeName: '责任人',
        progress: 30,
      },
    ],
  };

  assert.equal(getEffectiveStatusForUserIdentity(item, { id: 'owner-1', name: '责任人', username: 'owner-1' }), 'DISABLED');
});

test('getEffectiveItemStatus keeps reviewing items pending final approval even when all sub tasks are completed', () => {
  assert.equal(
    getEffectiveItemStatus({
      ...baseItem,
      status: 'REVIEWING',
      subTasks: [
        {
          id: 'sub-1',
          parentItemId: 'item-1',
          title: '子任务',
          deadline: '',
          status: 'COMPLETED',
          assigneeId: 'owner-1',
          assigneeName: '责任人',
          progress: 100,
        },
      ],
    }),
    'REVIEWING',
  );
});

test('identity helpers recognize owner by name when historical item lacks matching owner id', () => {
  const item = {
    ...baseItem,
    ownerId: 'legacy-owner-id',
    ownerName: '黄志豪',
    ownerIds: [],
    ownerNames: ['黄志豪'],
    subTasks: [
      {
        id: 'sub-1',
        parentItemId: 'item-1',
        title: '子任务',
        deadline: '',
        status: 'PENDING' as const,
        assigneeName: '黄志豪',
        progress: 0,
      },
    ],
  };

  assert.equal(isItemOwnerForUser(item, { id: '00001234', name: '黄志豪', username: 'huangzhihao' }), true);
  assert.equal(getEffectiveStatusForUserIdentity(item, { id: '00001234', name: '黄志豪', username: 'huangzhihao' }), 'PENDING');
});

test('getItemSignOffStatus 单责任人：未签收 / 已签收', () => {
  assert.deepEqual(getItemSignOffStatus({ ...baseItem, ownerName: '', ownerNames: ['张三'] }), { status: 'NOT_SIGNED', signedCount: 0, totalCount: 1 });
  assert.deepEqual(
    getItemSignOffStatus({ ...baseItem, ownerName: '', ownerNames: ['张三'], timeline: [{ id: 't1', type: 'SIGN', user: '张三', content: '签收', timestamp: '' }] }),
    { status: 'SIGNED', signedCount: 1, totalCount: 1 },
  );
});

test('getItemSignOffStatus 兼容缺少 SIGN 时间轴的历史子任务签收状态', () => {
  assert.deepEqual(
    getItemSignOffStatus({
      ...baseItem,
      ownerId: '',
      ownerName: '',
      ownerIds: ['u1', 'u2', 'u3'],
      ownerNames: ['张三', '李四', '王五'],
      subTasks: [
        { id: 's1', parentItemId: 'item-1', title: '张三任务', deadline: '', status: 'OVERDUE', assigneeId: 'u1', assigneeName: '张三', progress: 0 },
        { id: 's2', parentItemId: 'item-1', title: '李四任务', deadline: '', status: 'EXECUTING', assigneeId: 'u2', assigneeName: '李四', progress: 0 },
        { id: 's3', parentItemId: 'item-1', title: '王五任务', deadline: '', status: 'PENDING', assigneeId: 'u3', assigneeName: '王五', progress: 0 },
      ],
    }),
    { status: 'PARTIAL', signedCount: 2, totalCount: 3 },
  );
});

test('getItemSignOffStatus 有子任务时以子任务状态为准，PENDING 不被 SIGN 时间轴误算', () => {
  assert.deepEqual(
    getItemSignOffStatus({
      ...baseItem,
      ownerId: '',
      ownerName: '',
      ownerIds: ['u1', 'u2', 'u3'],
      ownerNames: ['牛绍宇', '魏红义', '申林'],
      subTasks: [
        { id: 's1', parentItemId: 'item-1', title: '牛绍宇任务', deadline: '', status: 'PENDING', assigneeId: 'u1', assigneeName: '牛绍宇', progress: 0 },
        { id: 's2', parentItemId: 'item-1', title: '魏红义任务', deadline: '', status: 'PENDING', assigneeId: 'u2', assigneeName: '魏红义', progress: 0 },
        { id: 's3', parentItemId: 'item-1', title: '申林任务', deadline: '', status: 'PENDING', assigneeId: 'u3', assigneeName: '申林', progress: 0 },
      ],
      timeline: [{ id: 't1', type: 'SIGN', user: '牛绍宇', actorUserId: 'u1', content: '签收', timestamp: '' }],
    }),
    { status: 'NOT_SIGNED', signedCount: 0, totalCount: 3 },
  );
});

test('getItemSignOffStatus 多责任人：独立签收（部分签收 PARTIAL，互不干扰）', () => {
  const multi: SupervisionItem = { ...baseItem, ownerName: '', ownerNames: ['张三', '李四'], timeline: [] };
  assert.deepEqual(getItemSignOffStatus(multi), { status: 'NOT_SIGNED', signedCount: 0, totalCount: 2 });
  assert.deepEqual(
    getItemSignOffStatus({ ...multi, timeline: [{ id: 't1', type: 'SIGN', user: '张三', content: '签收', timestamp: '' }] }),
    { status: 'PARTIAL', signedCount: 1, totalCount: 2 },
  );
  assert.deepEqual(
    getItemSignOffStatus({
      ...multi,
      timeline: [
        { id: 't1', type: 'SIGN', user: '张三', content: '签收', timestamp: '' },
        { id: 't2', type: 'SIGN', user: '李四', content: '签收', timestamp: '' },
      ],
    }),
    { status: 'SIGNED', signedCount: 2, totalCount: 2 },
  );
});

test('getEffectiveItemStatus 优先使用后端下发的有效状态', () => {
  assert.equal(
    getEffectiveItemStatus({ ...baseItem, status: 'PENDING', effectiveStatus: 'EXECUTING', timeline: [] }),
    'EXECUTING',
  );
});

test('getEffectiveItemStatus 签收后的展示状态只认后端 effectiveStatus', () => {
  const signNode = (user: string) => ({ id: 't', type: 'SIGN' as const, user, content: '签收', timestamp: '' });
  const timelineOnlyItem = {
    ...baseItem,
    ownerName: '',
    ownerNames: ['张三'],
    timeline: [signNode('张三')],
  };

  assert.equal(getEffectiveItemStatus(timelineOnlyItem), 'PENDING');
  assert.equal(getEffectiveItemStatus({ ...timelineOnlyItem, effectiveStatus: 'EXECUTING' }), 'EXECUTING');
});
