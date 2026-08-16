import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCreateItemMessages,
  buildDelayMessages,
  buildFeedbackMessages,
  buildSuspendMessages,
  resolveApprovalStep,
} from './item-workflow';

test('buildCreateItemMessages creates owner and follower notifications with de-duplicated targets', () => {
  const messages = buildCreateItemMessages({
    itemId: 'item-1',
    serialNo: 'DB-2026-001',
    title: 'DB-2026-001',
    ownerIds: ['owner-1', 'owner-1'],
    ownerNames: ['李承办', '李承办'],
    followerIds: ['follower-1'],
    followerNames: ['吴艺悦'],
    senderId: 'org-admin-1',
    senderName: '吴艺悦',
  });

  assert.equal(messages.length, 2);
  assert.deepEqual(
    messages.map((message) => ({
      title: message.title,
      receiverId: message.receiverId,
      type: message.type,
      link: message.link,
    })),
    [
      {
        title: '待办提醒',
        receiverId: 'owner-1',
        type: 'TODO',
        link: '/items/item-1',
      },
      {
        title: '负责通知',
        receiverId: 'follower-1',
        type: 'TODO',
        link: '/items/item-1',
      },
    ],
  );
});

test('buildFeedbackMessages creates follower notifications and skips sender', () => {
  const messages = buildFeedbackMessages({
    itemId: 'item-1',
    itemTitle: '督办事项A',
    feedbackContent: '已完成阶段性整改',
    followerIds: ['follower-1', 'owner-1', 'follower-1'],
    followerNames: ['王跟进', '李承办', '王跟进'],
    senderId: 'owner-1',
    senderName: '李承办',
  });

  assert.equal(messages.length, 1);
  assert.deepEqual(
    messages.map((message) => ({
      title: message.title,
      receiverId: message.receiverId,
      receiverName: message.receiverName,
      type: message.type,
      link: message.link,
      content: message.content,
    })),
    [
      {
        title: '反馈提醒',
        receiverId: 'follower-1',
        receiverName: '王跟进',
        type: 'TODO',
        link: '/items/item-1',
        content: '李承办 提交了【督办事项A】的进度反馈：已完成阶段性整改',
      },
    ],
  );
});

test('buildFeedbackMessages creates owner notifications for follower feedback', () => {
  const messages = buildFeedbackMessages({
    itemId: 'item-1',
    itemTitle: '督办事项A',
    feedbackContent: '请补充整改照片',
    ownerIds: ['owner-1', 'follower-1', 'owner-1'],
    ownerNames: ['武希明', '洪瑞金', '武希明'],
    senderId: 'follower-1',
    senderName: '洪瑞金',
  });

  assert.equal(messages.length, 1);
  assert.deepEqual(
    messages.map((message) => ({
      title: message.title,
      receiverId: message.receiverId,
      receiverName: message.receiverName,
      type: message.type,
      link: message.link,
      content: message.content,
    })),
    [
      {
        title: '反馈提醒',
        receiverId: 'owner-1',
        receiverName: '武希明',
        type: 'TODO',
        link: '/items/item-1',
        content: '洪瑞金 对【督办事项A】反馈了意见：请补充整改照片',
      },
    ],
  );
});

test('buildSuspendMessages creates owner notifications with item link and skips sender', () => {
  const messages = buildSuspendMessages({
    itemId: 'item-1',
    itemTitle: '督办事项A',
    reason: '等待外部材料',
    resumeDate: '2026-06-30',
    ownerIds: ['owner-1', 'follower-1', 'owner-1'],
    ownerNames: ['武希明', '洪瑞金', '武希明'],
    senderId: 'follower-1',
    senderName: '洪瑞金',
  });

  assert.equal(messages.length, 1);
  assert.deepEqual(
    messages.map((message) => ({
      title: message.title,
      receiverId: message.receiverId,
      receiverName: message.receiverName,
      type: message.type,
      link: message.link,
      content: message.content,
    })),
    [
      {
        title: '暂缓通知',
        receiverId: 'owner-1',
        receiverName: '武希明',
        type: 'TODO',
        link: '/items/item-1',
        content: '洪瑞金 已将【督办事项A】设置为暂缓状态，原因：等待外部材料，计划恢复：2026-06-30。',
      },
    ],
  );
});

test('buildDelayMessages notifies related people once and skips the applicant', () => {
  const messages = buildDelayMessages({
    itemId: 'item-1',
    itemTitle: '督办事项A',
    reason: '等待外部材料',
    plannedCompletionDate: '2026-08-20',
    ownerIds: ['owner-1', 'follower-1'],
    ownerNames: ['李承办', '王跟进'],
    followerIds: ['follower-1'],
    followerNames: ['王跟进'],
    senderId: 'owner-1',
    senderName: '李承办',
  });

  assert.deepEqual(messages.map((message) => ({ title: message.title, receiverId: message.receiverId, content: message.content })), [
    {
      title: '延期通知',
      receiverId: 'follower-1',
      content: '李承办 已对【督办事项A】申请延期，新计划完成日期：2026-08-20，原因：等待外部材料。',
    },
  ]);
});

test('resolveApprovalStep keeps sub-tasks unchanged for non-final approvers (no premature completion)', () => {
  const result = resolveApprovalStep({
    approved: true,
    isFinalApprover: false,
    itemTitle: '督办事项A',
    ownerId: 'owner-1',
    ownerName: '李承办',
    currentUserName: '吴艺悦',
    currentSubTasks: [
      { assigneeId: 'owner-1', status: 'REVIEWING', progress: 100 },
      { assigneeId: 'owner-2', status: 'EXECUTING', progress: 50 },
    ],
  });

  assert.equal(result.nextStatus, 'REVIEWING');
  assert.equal(result.timelineContent, '审批通过，已提交上级领导终审');
  assert.equal(result.ownerMessage?.content, '【督办事项A】专员已审批通过，等待上级领导终审。');
  // 非终审：所有子任务状态保持不变，绝不能误标为已完成
  assert.deepEqual(result.nextSubTasks, [
    { assigneeId: 'owner-1', status: 'REVIEWING', progress: 100 },
    { assigneeId: 'owner-2', status: 'EXECUTING', progress: 50 },
  ]);
});

test('resolveApprovalStep completes only the applicant sub-task for final approvers (others untouched, parent takes worst status)', () => {
  const result = resolveApprovalStep({
    approved: true,
    isFinalApprover: true,
    itemTitle: '督办事项A',
    ownerId: 'owner-1',
    ownerName: '李承办',
    currentUserName: '黎敏',
    currentSubTasks: [
      { assigneeId: 'owner-1', assigneeName: '李承办', status: 'REVIEWING', progress: 100 },
      { assigneeId: 'owner-2', assigneeName: '张三', status: 'EXECUTING', progress: 50 },
    ],
  });

  // 仅申请人(owner-1)子任务置 COMPLETED；owner-2 仍为 EXECUTING（保持不变）
  const owner1 = (result.nextSubTasks || []).find((t) => t.assigneeId === 'owner-1');
  const owner2 = (result.nextSubTasks || []).find((t) => t.assigneeId === 'owner-2');
  assert.equal(owner1?.status, 'COMPLETED');
  assert.equal(owner2?.status, 'EXECUTING');
  // 父级取最差状态：仍处 EXECUTING（others 未完成 → 父级不办结）
  assert.equal(result.nextStatus, 'EXECUTING');
  assert.equal(result.timelineContent, '审批通过，事项已完成');
  assert.equal(result.ownerMessage?.content, '【督办事项A】审批通过，您负责的子任务已完成。');
  assert.equal(result.ownerMessage?.receiverId, 'owner-1');
});

test('resolveApprovalStep completes the whole item when all sub-tasks belong to the applicant', () => {
  const result = resolveApprovalStep({
    approved: true,
    isFinalApprover: true,
    itemTitle: '督办事项A',
    ownerId: 'owner-1',
    ownerName: '李承办',
    currentUserName: '黎敏',
    currentSubTasks: [
      { assigneeId: 'owner-1', assigneeName: '李承办', status: 'REVIEWING', progress: 100 },
    ],
  });

  assert.equal(result.nextStatus, 'COMPLETED');
  assert.equal(result.timelineContent, '审批通过，事项已完成');
  assert.equal(result.ownerMessage?.content, '【督办事项A】审批通过，您负责的子任务已完成。');
});
