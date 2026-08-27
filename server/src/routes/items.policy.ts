import { isFollowerRoleIdentity } from './role-identity';
import { hasPageAction } from './module-authz';
import { asStringArray, pageSupportsAction, parseAllowedActions } from './page-actions';
import { canUserTransitionItemStatus, isItemStatus } from '../lib/item-state-machine';

const EDITABLE_ITEM_FIELDS = new Set([
  'serialNo',
  'title',
  'content',
  'deadline',
  'ownerId',
  'ownerName',
  'followerId',
  'followerName',
  'progress',
  'lightStatus',
  'lastFeedbackDate',
  'category',
  'campus',
  'meetingSource',
  'meetingName',
  'raiseDate',
  'requiredCompletionDate',
  'plannedCompletionDate',
  'actualCompletionDate',
  'status',
  'ownerIds',
  'ownerNames',
  'followerIds',
  'followerNames',
  'deptNames',
  'subTasks',
  'sharedWith',
  'attachments',
  'timeline',
  'rejectReason',
  'changeHistory',
]);

const UNSUPPORTED_ITEM_UPDATE_FIELDS = new Set([
  'restartDate',
  'issuerId',
  'issuerName',
  'issuerAccount',
]);

const ITEM_WRITE_ACTIONS = new Set([
  'EDIT_ITEM',
  'CREATE_ITEM',
  'DELETE_ITEM',
  'SIGN_ITEM',
  'FEEDBACK_ITEM',
  'DELAY_ITEM',
  'URGE_ITEM',
  'CHANGE_ITEM',
  'SUSPEND_ITEM',
  'RESTART_ITEM',
  'DISABLE_ITEM',
  'REJECT_ITEM',
  'APPROVE_ITEM',
  'APPLY_COMPLETE_ITEM',
  'MARK_UNSATISFIED_ITEM',
  'SHARE_ITEM',
]);

function normalizeStringArray(value: unknown): string[] {
  return asStringArray(value);
}

function normalizeDateValue(value: unknown): unknown {
  if (typeof value !== 'string' || !value) return value;
  return new Date(value);
}

function sanitizeAttachmentMetadata(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((attachment) => {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) return attachment;
    const record = attachment as Record<string, unknown>;
    if (typeof record.storageKey !== 'string' || !record.storageKey) return attachment;
    const { url: _signedUrl, ...persisted } = record;
    return persisted;
  });
}

export function getInvalidItemUpdateFields(payload: Record<string, unknown>): string[] {
  return Object.keys(payload).filter((field) => UNSUPPORTED_ITEM_UPDATE_FIELDS.has(field));
}

export function isSubTaskOnlyUpdatePayload(payload: Record<string, unknown>): boolean {
  const keys = Object.keys(payload).filter((field) => field !== 'updatedAt');
  return keys.length === 1 && keys[0] === 'subTasks';
}

export function sanitizeItemUpdates(payload: Record<string, unknown>, now = new Date()): Record<string, unknown> {
  const updates: Record<string, unknown> = { updatedAt: now };

  Object.entries(payload).forEach(([field, value]) => {
    if (!EDITABLE_ITEM_FIELDS.has(field)) return;
    if (field === 'rejectReason' || field === 'timeline') return;

    if (field === 'deadline' || field === 'lastFeedbackDate' || field === 'raiseDate' || field === 'deletedAt' ||
        field === 'requiredCompletionDate' || field === 'plannedCompletionDate' || field === 'actualCompletionDate') {
      updates[field] = normalizeDateValue(value);
      return;
    }

    // meetingName → meetingSource (前端字段 → 后端数据库字段)
    if (field === 'meetingName' && value !== undefined) {
      updates['meetingSource'] = value;
      return;
    }

    if (field === 'attachments') {
      updates[field] = sanitizeAttachmentMetadata(value);
      return;
    }

    updates[field] = value;
  });

  return updates;
}

export function canManageItems(input: {
  role?: string | null;
  roleId?: string | null;
  roleConfig?: {
    permissions?: unknown;
    allowedActions?: unknown;
  } | null;
}): boolean {
  const role = input.role || '';
  const permissions = normalizeStringArray(input.roleConfig?.permissions);
  const allowedActions = parseAllowedActions(input.roleConfig?.allowedActions);

  if (role === 'ADMIN' || permissions.includes('ALL')) return true;
  if (allowedActions === null) return false;
  if (allowedActions.some(action => ITEM_WRITE_ACTIONS.has(String(action)))) {
    return true;
  }
  return false;
}

export function canUseItemAction(input: {
  role?: string | null;
  roleConfig?: {
    permissions?: unknown;
    allowedActions?: unknown;
    allowedPageActions?: unknown;
  } | null;
  pageAuth?: string | null;
  action: string;
}): boolean {
  const permissions = normalizeStringArray(input.roleConfig?.permissions);
  const allowedActions = parseAllowedActions(input.roleConfig?.allowedActions);

  if (input.pageAuth === null) return false;
  if (input.role === 'ADMIN') {
    return input.pageAuth === undefined || pageSupportsAction(input.pageAuth, input.action);
  }
  if (permissions.includes('ALL')) {
    return input.pageAuth === undefined || hasPageAction(input.roleConfig, input.pageAuth, input.action);
  }
  if (allowedActions === null) return false;
  if (input.pageAuth !== undefined) {
    if (!input.pageAuth || !permissions.includes(input.pageAuth)) return false;
    return hasPageAction(input.roleConfig, input.pageAuth, input.action);
  }
  if (allowedActions.includes(input.action)) return true;
  return allowedActions.includes('EDIT_ITEM');
}

export function canUseSubTaskMutationAction(input: {
  role?: string | null;
  roleConfig?: {
    permissions?: unknown;
    allowedActions?: unknown;
    allowedPageActions?: unknown;
  } | null;
  pageAuth?: string | null;
}): boolean {
  return canUseItemAction({ ...input, action: 'CHANGE_ITEM' }) || canUseItemAction({ ...input, action: 'FEEDBACK_ITEM' });
}

type FollowerUserLike = {
  id: string;
  name?: string | null;
  role?: string | null;
  roleId?: string | null;
  roleIds?: unknown;
  status?: string | null;
};

export function isFollowerCandidateUser(user: FollowerUserLike): boolean {
  return isFollowerRoleIdentity(user);
}

export function hasFollowerSelectionPayload(payload: Record<string, unknown>): boolean {
  return 'followerId' in payload || 'followerName' in payload || 'followerIds' in payload || 'followerNames' in payload;
}

export function normalizeFollowerSelection(
  payload: Record<string, unknown>,
  users: FollowerUserLike[],
  options: { required?: boolean } = {},
): { valid: true; updates: { followerId?: string; followerName?: string; followerIds?: string[]; followerNames?: string[] } } | { valid: false; error: string } {
  const requestedIds = normalizeStringArray(payload.followerIds);
  const singleFollowerId = typeof payload.followerId === 'string' && payload.followerId.trim() ? payload.followerId.trim() : '';
  const followerIds = [...new Set((requestedIds.length > 0 ? requestedIds : singleFollowerId ? [singleFollowerId] : []).map(id => id.trim()).filter(Boolean))];

  if (followerIds.length === 0) {
    if (options.required || hasFollowerSelectionPayload(payload)) return { valid: false, error: '请至少选择一位督办专员' };
    return { valid: true, updates: {} };
  }

  const usersById = new Map(users.map(user => [user.id, user]));
  const followerUsers = followerIds.map(id => usersById.get(id));
  const missingId = followerIds.find((_, index) => !followerUsers[index]);
  if (missingId) return { valid: false, error: `督办专员账号不存在：${missingId}` };

  const inactiveUser = followerUsers.find(user => user?.status && user.status !== 'ACTIVE');
  if (inactiveUser) return { valid: false, error: `督办专员账号已停用：${inactiveUser.name || inactiveUser.id}` };

  const invalidUser = followerUsers.find(user => user && !isFollowerCandidateUser(user));
  if (invalidUser) return { valid: false, error: `只能选择督办专员作为跟进人：${invalidUser.name || invalidUser.id}` };

  const followerNames = followerUsers.map(user => user?.name || user?.id || '');
  return {
    valid: true,
    updates: {
      followerId: followerIds[0],
      followerName: followerNames[0],
      followerIds,
      followerNames,
    },
  };
}

export function isFollowerFeedbackTimelineNode(node: unknown): boolean {
  return typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    (node as { type?: unknown }).type === 'FOLLOWER_FEEDBACK';
}

/** 跟进人反馈在数据层仍走 CHANGE_ITEM 兼容旧角色配置；用于权限兜底识别该语义。 */
export function isFollowerFeedbackUpdatePayload(payload: Record<string, unknown>): boolean {
  return isFollowerFeedbackTimelineNode(getLatestTimelineNode(payload.timeline));
}

function getLatestTimelineNode(value: unknown): unknown {
  if (!Array.isArray(value)) return undefined;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const node = value[index];
    if (typeof node === 'object' && node !== null && 'type' in node && typeof node.type === 'string') {
      return node;
    }
  }
  return undefined;
}

function getPrimaryActionForItemUpdate(payload: Record<string, unknown>, currentStatus?: string | null): string {
  const nextStatus = typeof payload.status === 'string' ? payload.status : undefined;
  const latestTimelineNode = getLatestTimelineNode(payload.timeline);
  const hasStatusTransition = nextStatus !== undefined && (currentStatus == null || nextStatus !== currentStatus);

  if (nextStatus === 'REVIEWING' && currentStatus === 'REVIEWING') return 'APPROVE_ITEM';
  if (hasStatusTransition && currentStatus === 'DELETED' && nextStatus !== 'DELETED') return 'RESTART_ITEM';
  if (hasStatusTransition && nextStatus === 'DELETED') return 'DELETE_ITEM';
  if (hasStatusTransition && nextStatus === 'DISABLED') return 'DISABLE_ITEM';
  if (hasStatusTransition && nextStatus === 'SUSPENDED') return 'SUSPEND_ITEM';
  if (hasStatusTransition && nextStatus === 'DELAYED') return 'DELAY_ITEM';
  if (hasStatusTransition && nextStatus === 'REVIEWING') return 'APPLY_COMPLETE_ITEM';
  if (hasStatusTransition && nextStatus === 'NOT_SATISFIED') return 'MARK_UNSATISFIED_ITEM';
  if (hasStatusTransition && nextStatus === 'COMPLETED') return 'APPROVE_ITEM';
  if (hasStatusTransition && nextStatus === 'EXECUTING' && currentStatus === 'PENDING') return 'SIGN_ITEM';
  if (hasStatusTransition && nextStatus === 'EXECUTING' && ['SUSPENDED', 'DISABLED'].includes(currentStatus || '')) return 'RESTART_ITEM';
  if (hasStatusTransition && nextStatus === 'EXECUTING' && currentStatus === 'REVIEWING') return 'REJECT_ITEM';

  if ('sharedWith' in payload) return 'SHARE_ITEM';
  const timelineAction = mapTimelineNodeToAction(latestTimelineNode);
  if (timelineAction) return timelineAction;
  if ('attachments' in payload) return 'FEEDBACK_ITEM';
  if ('timeline' in payload) return 'FEEDBACK_ITEM';
  if ('lastFeedbackDate' in payload || 'progress' in payload) return 'FEEDBACK_ITEM';
  if ('deadline' in payload || 'plannedCompletionDate' in payload) return 'DELAY_ITEM';
  return 'CHANGE_ITEM';
}

type CurrentItemRef = { status: string | null; timelineIds: Set<string>; canDiff: boolean };

function resolveCurrentItemRef(currentStatusOrItem?: unknown): CurrentItemRef {
  if (currentStatusOrItem && typeof currentStatusOrItem === 'object') {
    const item = currentStatusOrItem as Record<string, unknown>;
    const status = typeof item.status === 'string' ? item.status : null;
    const timelineIds = new Set<string>();
    if (Array.isArray(item.timeline)) {
      for (const node of item.timeline) {
        if (node && typeof node === 'object' && 'id' in (node as object)) {
          const id = (node as { id?: unknown }).id;
          if (typeof id === 'string') timelineIds.add(id);
        }
      }
    }
    return { status, timelineIds, canDiff: true };
  }
  return { status: typeof currentStatusOrItem === 'string' ? currentStatusOrItem : null, timelineIds: new Set(), canDiff: false };
}

export function mapTimelineNodeToAction(node: unknown): string | null {
  if (!node || typeof node !== 'object' || !('type' in node)) return null;
  switch ((node as { type?: unknown }).type) {
    case 'SIGN': return 'SIGN_ITEM';
    case 'SHARE': return 'SHARE_ITEM';
    case 'URGE': return 'URGE_ITEM';
    case 'FEEDBACK': return 'FEEDBACK_ITEM';
    case 'FOLLOWER_FEEDBACK': return 'CHANGE_ITEM';
    case 'APPLY_COMPLETE': return 'APPLY_COMPLETE_ITEM';
    case 'SATISFIED': return 'MARK_UNSATISFIED_ITEM';
    case 'SUSPEND': return 'SUSPEND_ITEM';
    case 'DELAY': return 'DELAY_ITEM';
    case 'RESTART': return 'RESTART_ITEM';
    case 'DISABLE': return 'DISABLE_ITEM';
    case 'CHANGE': return 'CHANGE_ITEM';
    case 'CREATE': return 'CHANGE_ITEM';
    default: return null;
  }
}

// 普通字段编辑会落到 CHANGE_ITEM；这些字段已映射到各自专属动作，不应再触发 CHANGE_ITEM。
const NON_GENERAL_FIELDS = new Set([
  'status', 'timeline', 'sharedWith', 'attachments', 'lastFeedbackDate', 'progress',
  'subTasks', 'deadline', 'plannedCompletionDate', 'deletedAt', 'deletedById',
  'updatedAt', 'originalStatus',
]);

const GENERAL_EDIT_FIELDS = new Set([
  'title', 'content', 'ownerId', 'ownerName', 'followerId', 'followerName',
  'ownerIds', 'ownerNames', 'followerIds', 'followerNames', 'category', 'campus',
  'meetingSource', 'meetingName', 'raiseDate', 'requiredCompletionDate',
  'actualCompletionDate', 'lightStatus', 'deptNames', 'rejectReason',
]);

export function getRequiredActionsForItemUpdate(
  payload: Record<string, unknown>,
  currentStatusOrItem?: string | null | Record<string, unknown>,
): string[] {
  const { status: currentStatus, timelineIds: oldTimelineIds, canDiff } = resolveCurrentItemRef(currentStatusOrItem);
  const actions: string[] = [];
  const seen = new Set<string>();
  const push = (action: string | null) => {
    if (action && !seen.has(action)) {
      seen.add(action);
      actions.push(action);
    }
  };

  // 1. 新追加的时间线节点（仅当能对照当前事项时间线做差量时）。
  if (canDiff && Array.isArray(payload.timeline)) {
    for (const node of payload.timeline) {
      const id = node && typeof node === 'object' && 'id' in (node as object) ? (node as { id?: unknown }).id : undefined;
      if (typeof id === 'string' && oldTimelineIds.has(id)) continue;
      push(mapTimelineNodeToAction(node));
    }
  }

  // 2. 状态流转 / 主动作。
  push(getPrimaryActionForItemUpdate(payload, currentStatus));

  // 3. 显式共享。
  if ('sharedWith' in payload) push('SHARE_ITEM');

  // 4. 责任人反馈（最新时间线节点为责任人反馈，或显式反馈字段；最新节点为跟进人反馈时跳过）。
  const latestNode = getLatestTimelineNode(payload.timeline);
  const isFollowerFeedback = isFollowerFeedbackTimelineNode(latestNode);
  const isOwnerFeedbackNode = typeof latestNode === 'object' &&
    latestNode !== null &&
    'type' in latestNode &&
    (latestNode as { type?: unknown }).type === 'FEEDBACK';
  if (!isFollowerFeedback && (isOwnerFeedbackNode || 'attachments' in payload || 'lastFeedbackDate' in payload)) {
    push('FEEDBACK_ITEM');
  }

  // 5. 普通字段编辑。
  if (Object.keys(payload).some((field) => GENERAL_EDIT_FIELDS.has(field) && !NON_GENERAL_FIELDS.has(field))) {
    push('CHANGE_ITEM');
  }

  return actions;
}

export function getActionForItemUpdate(payload: Record<string, unknown>, currentStatus?: string | null): string {
  return getRequiredActionsForItemUpdate(payload, currentStatus)[0];
}

/**
 * 校验事项状态流转是否合法。返回 null 表示允许，返回字符串表示拒绝原因。
 * 所有已知源状态都采用显式白名单；未知源/目标状态一律拒绝，不能因新增枚举而默认放行。
 */
export function validateItemStatusTransition(payload: Record<string, unknown>, currentItem: Record<string, unknown>): string | null {
  if (!Object.prototype.hasOwnProperty.call(payload, 'status')) return null;
  const nextStatus = payload.status;
  if (!isItemStatus(nextStatus)) return '无效的督办事项状态';
  const currentStatus = currentItem?.status;
  if (!isItemStatus(currentStatus)) return '当前督办事项状态无效，请联系管理员';
  if (nextStatus === currentStatus) return null;

  if (nextStatus === 'COMPLETED' && currentStatus !== 'REVIEWING') {
    return '事项必须先提交完成申请，审批通过后才能办结';
  }

  // 回收站恢复只接受统一的 EXECUTING「恢复意图」；实际恢复状态必须取服务端保存的 originalStatus，
  // 不能由客户端指定，避免删除元数据被伪造或把事项恢复到错误状态。
  if (currentStatus === 'DELETED') {
    if (nextStatus !== 'EXECUTING') return '回收站事项只能执行恢复操作';
    const originalStatus = currentItem.originalStatus;
    if (!isItemStatus(originalStatus) || originalStatus === 'DELETED') {
      return '回收站事项缺少有效原状态，无法恢复';
    }
    return null;
  }
  return canUserTransitionItemStatus(currentStatus, nextStatus)
    ? null
    : `不允许将督办事项从「${currentStatus}」切换到「${nextStatus}」状态`;
}
