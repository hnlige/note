import { aggregateSubTaskStatus } from '../lib/item-effective-status';
import type { ItemStatus } from '../types';

type CreateItemMessageInput = {
  itemId: string;
  serialNo: string;
  title: string;
  ownerIds?: string[];
  ownerNames?: string[];
  followerIds?: string[];
  followerNames?: string[];
  senderId?: string | null;
  senderName?: string | null;
};

export type WorkflowMessage = {
  title: string;
  content: string;
  type: 'TODO' | 'NOTICE';
  link: string;
  receiverId: string;
  receiverName: string;
  senderId?: string | null;
  senderName?: string | null;
};

type FeedbackMessageInput = {
  itemId: string;
  itemTitle: string;
  feedbackContent: string;
  followerIds?: string[];
  followerNames?: string[];
  ownerIds?: string[];
  ownerNames?: string[];
  senderId?: string | null;
  senderName?: string | null;
};

type SuspendMessageInput = {
  itemId: string;
  itemTitle: string;
  reason?: string | null;
  resumeDate?: string | null;
  ownerIds?: string[];
  ownerNames?: string[];
  senderId?: string | null;
  senderName?: string | null;
};

type DelayMessageInput = {
  itemId: string;
  itemTitle: string;
  reason?: string | null;
  plannedCompletionDate: string;
  ownerIds?: string[];
  ownerNames?: string[];
  followerIds?: string[];
  followerNames?: string[];
  senderId?: string | null;
  senderName?: string | null;
};

type WorkflowSubTask = {
  assigneeId?: string;
  status?: string;
  progress?: number;
  [key: string]: unknown;
};

type ResolveApprovalStepInput = {
  approved: boolean;
  isFinalApprover: boolean;
  itemTitle: string;
  ownerId?: string | null;
  ownerName?: string | null;
  currentUserName: string;
  currentSubTasks?: WorkflowSubTask[];
};

type ResolveApprovalStepResult = {
  nextStatus: ItemStatus;
  timelineContent: string;
  nextSubTasks?: WorkflowSubTask[];
  ownerMessage?: WorkflowMessage;
};

function pushUniqueMessage(
  messages: WorkflowMessage[],
  uniqueTargets: Set<string>,
  dedupeKey: string,
  message: WorkflowMessage,
) {
  if (uniqueTargets.has(dedupeKey)) return;
  uniqueTargets.add(dedupeKey);
  messages.push(message);
}

export function buildCreateItemMessages(input: CreateItemMessageInput): WorkflowMessage[] {
  const link = `/items/${input.itemId}`;
  const uniqueTargets = new Set<string>();
  const messages: WorkflowMessage[] = [];

  (input.ownerIds || []).forEach((receiverId, index) => {
    const receiverName = input.ownerNames?.[index] || receiverId;
    if (!receiverId) return;
    pushUniqueMessage(messages, uniqueTargets, `owner:${receiverId}`, {
      title: '待办提醒',
      content: `您有一项新的督办任务待签收：【${input.serialNo}】`,
      type: 'TODO',
      link,
      receiverId,
      receiverName,
      senderId: input.senderId || null,
      senderName: input.senderName || null,
    });
  });

  (input.followerIds || []).forEach((receiverId, index) => {
    const receiverName = input.followerNames?.[index] || receiverId;
    if (!receiverId) return;
    pushUniqueMessage(messages, uniqueTargets, `follower:${receiverId}`, {
      title: '负责通知',
      content: `您被指定为【${input.serialNo}】的督办跟进人，请及时跟进。`,
      type: 'TODO',
      link,
      receiverId,
      receiverName,
      senderId: input.senderId || null,
      senderName: input.senderName || null,
    });
  });

  return messages;
}

export function buildFeedbackMessages(input: FeedbackMessageInput): WorkflowMessage[] {
  const link = `/items/${input.itemId}`;
  const uniqueTargets = new Set<string>();
  const messages: WorkflowMessage[] = [];

  (input.followerIds || []).forEach((receiverId, index) => {
    const receiverName = input.followerNames?.[index];
    if (!receiverId || !receiverName || receiverId === input.senderId) return;
    pushUniqueMessage(messages, uniqueTargets, `feedback:${receiverId}`, {
      title: '反馈提醒',
      content: `${input.senderName || '责任人'} 提交了【${input.itemTitle}】的进度反馈：${input.feedbackContent}`,
      type: 'TODO',
      link,
      receiverId,
      receiverName,
      senderId: input.senderId || null,
      senderName: input.senderName || null,
    });
  });

  (input.ownerIds || []).forEach((receiverId, index) => {
    const receiverName = input.ownerNames?.[index];
    if (!receiverId || !receiverName || receiverId === input.senderId) return;
    pushUniqueMessage(messages, uniqueTargets, `owner-feedback:${receiverId}`, {
      title: '反馈提醒',
      content: `${input.senderName || '督办专员'} 对【${input.itemTitle}】反馈了意见：${input.feedbackContent}`,
      type: 'TODO',
      link,
      receiverId,
      receiverName,
      senderId: input.senderId || null,
      senderName: input.senderName || null,
    });
  });

  return messages;
}

export function buildSuspendMessages(input: SuspendMessageInput): WorkflowMessage[] {
  const link = `/items/${input.itemId}`;
  const uniqueTargets = new Set<string>();
  const messages: WorkflowMessage[] = [];
  const reason = input.reason?.trim();
  const resumeDate = input.resumeDate?.trim();
  const suffix = [
    reason ? `原因：${reason}` : '',
    resumeDate ? `计划恢复：${resumeDate}` : '',
  ].filter(Boolean).join('，');

  (input.ownerIds || []).forEach((receiverId, index) => {
    const receiverName = input.ownerNames?.[index];
    if (!receiverId || !receiverName || receiverId === input.senderId) return;
    pushUniqueMessage(messages, uniqueTargets, `suspend:${receiverId}`, {
      title: '暂缓通知',
      content: `${input.senderName || '督办专员'} 已将【${input.itemTitle}】设置为暂缓状态${suffix ? `，${suffix}` : ''}。`,
      type: 'TODO',
      link,
      receiverId,
      receiverName,
      senderId: input.senderId || null,
      senderName: input.senderName || null,
    });
  });

  return messages;
}

export function buildDelayMessages(input: DelayMessageInput): WorkflowMessage[] {
  const link = `/items/${input.itemId}`;
  const uniqueTargets = new Set<string>();
  const messages: WorkflowMessage[] = [];
  const reason = input.reason?.trim();
  const suffix = [
    `新计划完成日期：${input.plannedCompletionDate}`,
    reason ? `原因：${reason}` : '',
  ].join('，');
  const appendRecipient = (receiverId: string, receiverName: string) => {
    if (!receiverId || !receiverName || receiverId === input.senderId) return;
    pushUniqueMessage(messages, uniqueTargets, `delay:${receiverId}`, {
      title: '延期通知',
      content: `${input.senderName || '系统'} 已对【${input.itemTitle}】申请延期，${suffix}。`,
      type: 'TODO',
      link,
      receiverId,
      receiverName,
      senderId: input.senderId || null,
      senderName: input.senderName || null,
    });
  };

  (input.ownerIds || []).forEach((receiverId, index) => appendRecipient(receiverId, input.ownerNames?.[index] || ''));
  (input.followerIds || []).forEach((receiverId, index) => appendRecipient(receiverId, input.followerNames?.[index] || ''));
  return messages;
}

type ShareMessageInput = {
  itemId: string;
  itemTitle: string;
  sharedBy?: string | null;
  targets: Array<{ userId: string; userName: string }>;
  senderId?: string | null;
  senderName?: string | null;
};

export function buildShareMessages(input: ShareMessageInput): WorkflowMessage[] {
  const link = `/items/${input.itemId}`;
  const uniqueTargets = new Set<string>();
  const messages: WorkflowMessage[] = [];
  const sharedBy = input.sharedBy?.trim() || '督办专员';

  (input.targets || []).forEach((target) => {
    if (!target?.userId || !target.userName) return;
    pushUniqueMessage(messages, uniqueTargets, `share:${target.userId}`, {
      title: '共享提醒',
      content: `${sharedBy} 将【${input.itemTitle}】共享给您，请及时关注跟进。`,
      type: 'TODO',
      link,
      receiverId: target.userId,
      receiverName: target.userName,
      senderId: input.senderId || null,
      senderName: input.senderName || null,
    });
  });

  return messages;
}

export function resolveApprovalStep(input: ResolveApprovalStepInput): ResolveApprovalStepResult {
  if (!input.approved) {
    return {
      nextStatus: 'EXECUTING',
      timelineContent: '审批驳回：未满足完成条件',
      nextSubTasks: input.currentSubTasks?.map((task) =>
        task.status === 'REVIEWING' ? { ...task, status: 'EXECUTING' } : task,
      ),
    };
  }

  if (input.isFinalApprover) {
    const actualCompletionDate = new Date().toISOString().slice(0, 10);
    const nextSubTasks = input.currentSubTasks?.map((task) => {
      const isApplicant =
        (input.ownerId && task.assigneeId && task.assigneeId === input.ownerId) ||
        (input.ownerName && task.assigneeName && task.assigneeName === input.ownerName);
      return isApplicant ? { ...task, status: 'COMPLETED', progress: 100, actualCompletionDate } : task;
    });
    const nextStatus = nextSubTasks && nextSubTasks.length > 0
      ? aggregateSubTaskStatus(nextSubTasks as any)
      : 'COMPLETED';
    return {
      nextStatus,
      timelineContent: '审批通过，事项已完成',
      nextSubTasks,
      ownerMessage: input.ownerId && input.ownerName
        ? {
            title: '办结通知',
            content: `【${input.itemTitle}】审批通过，您负责的子任务已完成。`,
            type: 'TODO',
            link: '',
            receiverId: input.ownerId,
            receiverName: input.ownerName,
          }
        : undefined,
    };
  }

  // 非终审（跟进人）审批：仅推进审批层级，不改变任何子任务状态，避免误将全部子任务标为已完成
  return {
    nextStatus: 'REVIEWING',
    timelineContent: '审批通过，已提交上级领导终审',
    nextSubTasks: input.currentSubTasks,
    ownerMessage: input.ownerId && input.ownerName
      ? {
            title: '审批进度通知',
            content: `【${input.itemTitle}】专员已审批通过，等待上级领导终审。`,
            type: 'TODO',
          link: '',
          receiverId: input.ownerId,
          receiverName: input.ownerName,
        }
      : undefined,
  };
}
