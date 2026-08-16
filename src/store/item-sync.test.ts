import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSyncedItems } from './item-sync.ts';
import { getEffectiveItemStatus } from '../lib/item-format.ts';
import { SupervisionItem } from '../types';

const fallbackItems: SupervisionItem[] = [
  {
    id: 'demo-1',
    serialNo: 'DB-2026-001',
    title: '安全生产大检查',
    content: '测试事项',
    status: 'EXECUTING',
    deadline: '2026-06-30',
    ownerId: 'owner-1',
    ownerName: '李承办',
    followerId: 'follower-1',
    followerName: '王跟进',
    progress: 45,
    effectiveStatus: 'OVERDUE',
    category: '行政管理',
    campus: '集团总部',
    timeline: [],
    subTasks: [
      {
        id: 'demo-1-sub-1',
        parentItemId: 'demo-1',
        title: '阶段任务',
        deadline: '2026-06-30',
        status: 'OVERDUE',
        assigneeId: 'owner-1',
        assigneeName: '李承办',
        progress: 45,
      },
    ],
  },
  {
    id: 'demo-2',
    serialNo: 'DB-2026-002',
    title: '扩建项目',
    content: '测试事项',
    status: 'EXECUTING',
    deadline: '2026-06-15',
    ownerId: 'owner-1',
    ownerName: '李承办',
    followerId: 'follower-1',
    followerName: '王跟进',
    progress: 80,
    effectiveStatus: 'SUSPENDED',
    category: '工程建设',
    campus: '第三院区',
    timeline: [],
    subTasks: [
      {
        id: 'demo-2-sub-1',
        parentItemId: 'demo-2',
        title: '阶段任务',
        deadline: '2026-06-25',
        status: 'SUSPENDED',
        assigneeId: 'owner-1',
        assigneeName: '李承办',
        progress: 80,
      },
    ],
  },
  {
    id: 'demo-3',
    serialNo: 'DB-2026-003',
    title: '科研成果汇总',
    content: '测试事项',
    status: 'COMPLETED',
    deadline: '2026-07-10',
    ownerId: 'owner-1',
    ownerName: '李承办',
    followerId: 'follower-1',
    followerName: '王跟进',
    progress: 100,
    category: '科研教育',
    campus: '全集团',
    timeline: [],
  },
];

test('resolveSyncedItems clears state when remote list is successfully empty', () => {
  const resolved = resolveSyncedItems([], [], fallbackItems);

  assert.deepEqual(resolved, []);
});

test('resolveSyncedItems falls back to local demo items when remote list is unavailable', () => {
  const resolved = resolveSyncedItems(null, [], fallbackItems);

  assert.equal(resolved.length, 3);
  assert.equal(getEffectiveItemStatus(resolved[0]), 'OVERDUE');
  assert.equal(getEffectiveItemStatus(resolved[1]), 'SUSPENDED');
  assert.equal(getEffectiveItemStatus(resolved[2]), 'COMPLETED');
});
