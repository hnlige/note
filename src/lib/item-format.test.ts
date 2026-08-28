import test from 'node:test';
import assert from 'node:assert/strict';

import { formatUrgeTimelineContent, getEffectiveItemStatus, getEffectiveStatusForUserIdentity, getItemSignOffStatus, getMobileItemStatus, isItemOwnerForUser, isItemRelatedToUser } from './item-format.ts';
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

test('isItemRelatedToUser includes a read-only shared user for mobile list visibility', () => {
  assert.equal(isItemRelatedToUser({
    ...baseItem,
    ownerId: 'other-owner',
    followerId: 'other-follower',
    sharedWith: [{ userId: 'shared-user', userName: '共享人员', sharedAt: '', sharedBy: '跟进人' }],
  }, { id: 'shared-user', name: '共享人员', username: 'shared' }), true);
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

test('多责任人详情页按责任人独立展示：一人超期不影响另一人的待签收状态', () => {
  const item = {
    ...baseItem,
    status: 'OVERDUE' as const,
    ownerId: '',
    ownerName: '',
    ownerIds: ['owner-a', 'owner-b'],
    ownerNames: ['责任人A', '责任人B'],
    subTasks: [
      {
        id: 'sub-a',
        parentItemId: 'item-1',
        title: 'A 的子任务',
        deadline: '2026/08/10',
        plannedCompletionDate: '2026/08/10',
        status: 'OVERDUE' as const,
        assigneeId: 'owner-a',
        assigneeName: '责任人A',
        progress: 0,
      },
      {
        id: 'sub-b',
        parentItemId: 'item-1',
        title: 'B 的子任务',
        deadline: '2026/08/01',
        requiredCompletionDate: '2026/08/01',
        plannedCompletionDate: '',
        status: 'PENDING' as const,
        assigneeId: 'owner-b',
        assigneeName: '责任人B',
        progress: 0,
      },
    ],
  };

  assert.equal(getEffectiveStatusForUserIdentity(item, { id: 'owner-a', name: '责任人A', username: 'owner-a' }), 'OVERDUE');
  assert.equal(getEffectiveStatusForUserIdentity(item, { id: 'owner-b', name: '责任人B', username: 'owner-b' }), 'PENDING');
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
        { id: 's1', parentItemId: 'item-1', title: '张三任务', deadline: '', plannedCompletionDate: '2026/08/01', status: 'OVERDUE', assigneeId: 'u1', assigneeName: '张三', progress: 0 },
        { id: 's2', parentItemId: 'item-1', title: '李四任务', deadline: '', plannedCompletionDate: '2026/08/02', status: 'EXECUTING', assigneeId: 'u2', assigneeName: '李四', progress: 0 },
        { id: 's3', parentItemId: 'item-1', title: '王五任务', deadline: '', status: 'PENDING', assigneeId: 'u3', assigneeName: '王五', progress: 0 },
      ],
    }),
    { status: 'PARTIAL', signedCount: 2, totalCount: 3 },
  );
});

test('多责任人反馈自动推进但未 SIGN 且无计划日期时仍显示本人待签收', () => {
  const item = {
    ...baseItem,
    status: 'EXECUTING' as const,
    ownerId: '',
    ownerName: '',
    ownerIds: ['u1', 'u2'],
    ownerNames: ['魏红义', '申林'],
    subTasks: [
      { id: 's1', parentItemId: 'item-1', title: '魏红义任务', deadline: '', status: 'EXECUTING' as const, assigneeId: 'u1', assigneeName: '魏红义', progress: 0 },
      { id: 's2', parentItemId: 'item-1', title: '申林任务', deadline: '', status: 'EXECUTING' as const, assigneeId: 'u2', assigneeName: '申林', progress: 0 },
    ],
    timeline: [{ id: 't1', type: 'SIGN' as const, user: '魏红义', actorUserId: 'u1', content: '签收', timestamp: '' }],
  };

  assert.equal(getEffectiveStatusForUserIdentity(item, { id: 'u1', name: '魏红义', username: '' }), 'EXECUTING');
  assert.equal(getEffectiveStatusForUserIdentity(item, { id: 'u2', name: '申林', username: '' }), 'PENDING');
  assert.deepEqual(getItemSignOffStatus(item), { status: 'PARTIAL', signedCount: 1, totalCount: 2 });
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

test('getMobileItemStatus 按责任人使用个人子任务状态', () => {
  const item = {
    ...baseItem,
    status: 'OVERDUE' as const,
    ownerId: '',
    ownerName: '',
    ownerIds: ['owner-a', 'owner-b'],
    ownerNames: ['责任人A', '责任人B'],
    subTasks: [
      { id: 'a', parentItemId: 'item-1', title: 'A', deadline: '', status: 'EXECUTING' as const, assigneeId: 'owner-a', assigneeName: '责任人A', plannedCompletionDate: '2026/08/31' },
      { id: 'b', parentItemId: 'item-1', title: 'B', deadline: '', status: 'PENDING' as const, assigneeId: 'owner-b', assigneeName: '责任人B' },
    ],
  };

  assert.equal(getMobileItemStatus(item, { id: 'owner-a', name: '责任人A', username: '' }), 'EXECUTING');
  assert.equal(getMobileItemStatus(item, { id: 'owner-b', name: '责任人B', username: '' }), 'PENDING');
  assert.equal(getMobileItemStatus(item, { id: 'follower', name: '跟进人', username: '' }), 'OVERDUE');
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

test('formatUrgeTimelineContent 将历史英文枚举后缀替换为中文', () => {
  assert.equal(
    formatUrgeTimelineContent('【催办】请尽快反馈 (SYSTEM)'),
    '【催办】请尽快反馈（站内推送）',
  );
  assert.equal(
    formatUrgeTimelineContent('【催办】电话联系 (PHONE)'),
    '【催办】电话联系（电话催办）',
  );
  assert.equal(
    formatUrgeTimelineContent('【催办】请反馈 (MESSAGE)'),
    '【催办】请反馈（消息通知）',
  );
  // 新数据已是中文，原样保留
  assert.equal(
    formatUrgeTimelineContent('【催办】请反馈（站内推送）'),
    '【催办】请反馈（站内推送）',
  );
  assert.equal(formatUrgeTimelineContent('普通反馈内容'), '普通反馈内容');
  assert.equal(formatUrgeTimelineContent(undefined), '');
});
