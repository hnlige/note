import test from 'node:test';
import assert from 'node:assert/strict';

import { useStore } from './useStore.ts';
import type { Role, SupervisionItem } from '../types';

const orgAdminRole: Role = {
  id: 'r5',
  name: '组织管理员',
  authCodes: ['MENU_ITEMS', 'MENU_MESSAGES'],
  dataScope: 'MULTI_ORG',
  followerDataScope: 'MULTI_ORG',
  allowedActions: ['READ', 'SEARCH', 'EXPORT', 'APPROVE_ITEM'],
};

const reviewItem: SupervisionItem = {
  id: 'review-item-1',
  serialNo: 'PW-REVIEW-001',
  title: 'PW-REVIEW-001',
  content: '审批回归测试',
  status: 'REVIEWING',
  deadline: '2026-06-28',
  ownerId: 'owner-1',
  ownerName: '刘维雷',
  followerId: 'org-admin-1',
  followerName: '吴艺悦',
  progress: 100,
  category: '自动化测试',
  campus: '测试院区',
  timeline: [],
  subTasks: [
    {
      id: 'subtask-1',
      parentItemId: 'review-item-1',
      title: '子任务',
      deadline: '2026-06-28',
      status: 'REVIEWING',
      assigneeId: 'owner-1',
      assigneeName: '刘维雷',
      progress: 100,
    },
  ],
};

const executingItem: SupervisionItem = {
  id: 'executing-item-1',
  serialNo: 'PW-EXEC-001',
  title: 'PW-EXEC-001',
  content: '未按要求完成回归测试',
  status: 'EXECUTING',
  deadline: '2026-06-28',
  ownerId: 'owner-1',
  ownerName: '刘维雷',
  followerId: 'org-admin-1',
  followerName: '吴艺悦',
  progress: 80,
  category: '自动化测试',
  campus: '测试院区',
  timeline: [],
};

const sharedItem: SupervisionItem = {
  ...executingItem,
  id: 'shared-item-1',
  serialNo: 'PW-SHARE-001',
  title: 'PW-SHARE-001',
  sharedWith: [
    { userId: 'shared-user-1', userName: '共享接收人', sharedAt: '2026-06-22 10:00', sharedBy: '吴艺悦' },
  ],
};

const overdueItem: SupervisionItem = {
  ...executingItem,
  id: 'overdue-item-1',
  serialNo: 'PW-OVERDUE-001',
  title: 'PW-OVERDUE-001',
  status: 'OVERDUE',
  deadline: '2026-06-20',
  progress: 65,
};

const nonOwnerOverdueItem: SupervisionItem = {
  ...overdueItem,
  id: 'overdue-item-2',
  serialNo: 'PW-OVERDUE-002',
  title: 'PW-OVERDUE-002',
  ownerId: 'other-owner',
  ownerName: '其他责任人',
};

test('approveComplete keeps org-admin items in REVIEWING locally but sends COMPLETED to backend approval workflow', async () => {
  const previousState = useStore.getState();
  const apiModule = await import('../lib/api.ts');
  const originalUpdate = apiModule.api.items.update;
  const updateCalls: Array<{ id: string; payload: Record<string, unknown> }> = [];

  apiModule.api.items.update = (async (id: string, payload: Record<string, unknown>) => {
    updateCalls.push({ id, payload });
    return { success: true };
  }) as typeof apiModule.api.items.update;

  try {
    useStore.setState({
      ...previousState,
      currentUser: {
        id: 'org-admin-1',
        name: '吴艺悦',
        role: 'FOLLOWER',
        roleId: 'r5',
        roleIds: ['r5'],
      },
      roles: [orgAdminRole],
      items: [reviewItem],
      activities: [],
    });

    useStore.getState().approveComplete(reviewItem.id, true);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const [updatedItem] = useStore.getState().items;
    assert.equal(updatedItem.status, 'REVIEWING');
    // 非终审（跟进人审批）：待审批子任务标记跟进人审批通过人，父级保持待审批完成，等待上级终审
    assert.equal(updatedItem.subTasks?.[0]?.followerApprovedBy, '吴艺悦');
    assert.equal(updatedItem.subTasks?.[0]?.status, 'REVIEWING');

    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0]?.id, reviewItem.id);
    // 始终向服务端发送 COMPLETED 以触发后端终审分支（后端按 isFinalApprover 决定实际状态）
    const expectedSubTasks = reviewItem.subTasks?.map((t) =>
      (t.status === 'REVIEWING' ? { ...t, followerApprovedBy: '吴艺悦' } : t));
    assert.deepEqual(updateCalls[0]?.payload, {
      status: 'COMPLETED',
      subTasks: expectedSubTasks,
    });
  } finally {
    apiModule.api.items.update = originalUpdate;
    useStore.setState(previousState, true);
  }
});

test('updateItem forwards explicit page context to the item API', async () => {
  const previousState = useStore.getState();
  const apiModule = await import('../lib/api.ts');
  const originalUpdate = apiModule.api.items.update;
  let capturedPageAuth: string | undefined;

  apiModule.api.items.update = (async (_id: string, _payload: Record<string, unknown>, pageAuth?: string) => {
    capturedPageAuth = pageAuth;
    return { success: true };
  }) as typeof apiModule.api.items.update;

  try {
    useStore.setState({ ...previousState, items: [reviewItem] });
    const updateWithContext = useStore.getState().updateItem as unknown as (
      id: string,
      updates: Record<string, unknown>,
      pageAuth?: string,
    ) => Promise<boolean>;

    await updateWithContext(reviewItem.id, { title: '上下文更新' }, 'MENU_ITEMS');

    assert.equal(capturedPageAuth, 'MENU_ITEMS');
  } finally {
    apiModule.api.items.update = originalUpdate;
    useStore.setState(previousState, true);
  }
});

test('applyUnsatisfied persists the unmet requirement note in backend timeline payload', async () => {
  const previousState = useStore.getState();
  const apiModule = await import('../lib/api.ts');
  const originalUpdate = apiModule.api.items.update;
  const updateCalls: Array<{ id: string; payload: Record<string, unknown> }> = [];

  apiModule.api.items.update = (async (id: string, payload: Record<string, unknown>) => {
    updateCalls.push({ id, payload });
    return { success: true };
  }) as typeof apiModule.api.items.update;

  try {
    useStore.setState({
      ...previousState,
      currentUser: {
        id: 'org-admin-1',
        name: '吴艺悦',
        role: 'FOLLOWER',
        roleId: 'r5',
        roleIds: ['r5'],
      },
      roles: [orgAdminRole],
      items: [executingItem],
      activities: [],
    });

    useStore.getState().applyUnsatisfied(executingItem.id, '材料不完整，未达到验收要求');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const [updatedItem] = useStore.getState().items;
    assert.equal(updatedItem.status, 'NOT_SATISFIED');
    assert.equal(updatedItem.timeline.length, 1);
    assert.equal(updatedItem.timeline[0]?.type, 'SATISFIED');
    assert.equal(updatedItem.timeline[0]?.content, '未按要求完成：材料不完整，未达到验收要求');

    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0]?.id, executingItem.id);
    assert.equal(updateCalls[0]?.payload.status, 'NOT_SATISFIED');
    const timeline = updateCalls[0]?.payload.timeline as SupervisionItem['timeline'];
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0]?.type, 'SATISFIED');
    assert.equal(timeline[0]?.content, '未按要求完成：材料不完整，未达到验收要求');
  } finally {
    apiModule.api.items.update = originalUpdate;
    useStore.setState(previousState, true);
  }
});

test('revokeShareItem removes shared user and persists revoke timeline payload', async () => {
  const previousState = useStore.getState();
  const apiModule = await import('../lib/api.ts');
  const originalUpdate = apiModule.api.items.update;
  const updateCalls: Array<{ id: string; payload: Record<string, unknown> }> = [];

  apiModule.api.items.update = (async (id: string, payload: Record<string, unknown>) => {
    updateCalls.push({ id, payload });
    return { success: true };
  }) as typeof apiModule.api.items.update;

  try {
    useStore.setState({
      ...previousState,
      currentUser: {
        id: 'org-admin-1',
        name: '吴艺悦',
        role: 'FOLLOWER',
        roleId: 'r5',
        roleIds: ['r5'],
      },
      roles: [orgAdminRole],
      items: [sharedItem],
      activities: [],
    });

    await useStore.getState().revokeShareItem(sharedItem.id, 'shared-user-1');

    const [updatedItem] = useStore.getState().items;
    assert.deepEqual(updatedItem.sharedWith, []);
    assert.equal(updatedItem.timeline[0]?.type, 'SHARE');
    assert.equal(updatedItem.timeline[0]?.content, '撤销共享：共享接收人');

    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0]?.id, sharedItem.id);
    assert.deepEqual(updateCalls[0]?.payload.sharedWith, []);
    const timeline = updateCalls[0]?.payload.timeline as SupervisionItem['timeline'];
    assert.equal(timeline[0]?.content, '撤销共享：共享接收人');
  } finally {
    apiModule.api.items.update = originalUpdate;
    useStore.setState(previousState, true);
  }
});

test('postponeItem updates overdue owner items to DELAYED and persists new deadline', async () => {
  const previousState = useStore.getState();
  const apiModule = await import('../lib/api.ts');
  const originalUpdate = apiModule.api.items.update;
  const updateCalls: Array<{ id: string; payload: Record<string, unknown> }> = [];

  apiModule.api.items.update = (async (id: string, payload: Record<string, unknown>) => {
    updateCalls.push({ id, payload });
    return { success: true };
  }) as typeof apiModule.api.items.update;

  try {
    useStore.setState({
      ...previousState,
      currentUser: {
        id: 'owner-1',
        name: '刘维雷',
        role: 'OWNER',
        roleId: 'r6',
        roleIds: ['r6'],
      },
      items: [overdueItem],
      activities: [],
    });

    useStore.getState().postponeItem(overdueItem.id, '等待外部资源到位', '2026/07/01');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const [updatedItem] = useStore.getState().items;
    assert.equal(updatedItem.status, 'DELAYED');
    assert.equal(updatedItem.deadline, '2026/07/01');
    assert.equal(updatedItem.plannedCompletionDate, '2026/07/01');
    assert.equal(updatedItem.timeline.at(-1)?.type, 'DELAY');
    assert.match(updatedItem.timeline.at(-1)?.content || '', /申请延期。原因：等待外部资源到位/);

    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0]?.id, overdueItem.id);
    assert.deepEqual(updateCalls[0]?.payload, {
      status: 'DELAYED',
      deadline: '2026/07/01',
      plannedCompletionDate: '2026/07/01',
    });
  } finally {
    apiModule.api.items.update = originalUpdate;
    useStore.setState(previousState, true);
  }
});

test('postponeItem ignores non-owner items even when they are overdue', async () => {
  const previousState = useStore.getState();
  const apiModule = await import('../lib/api.ts');
  const originalUpdate = apiModule.api.items.update;
  const updateCalls: Array<{ id: string; payload: Record<string, unknown> }> = [];

  apiModule.api.items.update = (async (id: string, payload: Record<string, unknown>) => {
    updateCalls.push({ id, payload });
    return { success: true };
  }) as typeof apiModule.api.items.update;

  try {
    useStore.setState({
      ...previousState,
      currentUser: {
        id: 'owner-1',
        name: '刘维雷',
        role: 'OWNER',
        roleId: 'r6',
        roleIds: ['r6'],
      },
      items: [nonOwnerOverdueItem],
      activities: [],
    });

    useStore.getState().postponeItem(nonOwnerOverdueItem.id, '不应生效', '2026/07/01');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const [updatedItem] = useStore.getState().items;
    assert.equal(updatedItem.status, 'OVERDUE');
    assert.equal(updatedItem.deadline, '2026-06-20');
    assert.equal(updatedItem.plannedCompletionDate, undefined);
    assert.equal(updateCalls.length, 0);
  } finally {
    apiModule.api.items.update = originalUpdate;
    useStore.setState(previousState, true);
  }
});

test('postponeItem ignores owner items that are not overdue', async () => {
  const previousState = useStore.getState();
  const apiModule = await import('../lib/api.ts');
  const originalUpdate = apiModule.api.items.update;
  const updateCalls: Array<{ id: string; payload: Record<string, unknown> }> = [];

  apiModule.api.items.update = (async (id: string, payload: Record<string, unknown>) => {
    updateCalls.push({ id, payload });
    return { success: true };
  }) as typeof apiModule.api.items.update;

  try {
    useStore.setState({
      ...previousState,
      currentUser: {
        id: 'owner-1',
        name: '刘维雷',
        role: 'OWNER',
        roleId: 'r6',
        roleIds: ['r6'],
      },
      items: [executingItem],
      activities: [],
    });

    useStore.getState().postponeItem(executingItem.id, '不应生效', '2026/07/01');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const [updatedItem] = useStore.getState().items;
    assert.equal(updatedItem.status, 'EXECUTING');
    assert.equal(updatedItem.deadline, '2026-06-28');
    assert.equal(updatedItem.plannedCompletionDate, undefined);
    assert.equal(updateCalls.length, 0);
  } finally {
    apiModule.api.items.update = originalUpdate;
    useStore.setState(previousState, true);
  }
});
