import type { ItemStatus } from '../types';

const ITEM_STATUSES: ReadonlySet<ItemStatus> = new Set([
  'PENDING',
  'EXECUTING',
  'OVERDUE',
  'DELAYED',
  'SUSPENDED',
  'COMPLETED',
  'ARCHIVED',
  'DELETED',
  'DISABLED',
  'NOT_SATISFIED',
  'REVIEWING',
]);

/**
 * 用户操作允许的完整状态转换表。
 *
 * OVERDUE 是服务端自动计算的系统态，ARCHIVED 是归档流程的目标态，均不能由通用
 * 事项更新接口直接写入。所有通用接口状态修改都必须经过本表，避免新增状态后默认放行。
 */
const USER_STATUS_TRANSITIONS: Readonly<Record<ItemStatus, ReadonlySet<ItemStatus>>> = {
  PENDING: new Set(['EXECUTING', 'DELETED', 'DISABLED']),
  EXECUTING: new Set(['SUSPENDED', 'REVIEWING', 'DELAYED', 'COMPLETED', 'DELETED', 'DISABLED', 'NOT_SATISFIED']),
  // 责任人签收或反馈可以将历史超期事项重新推进为执行中；是否仍超期由服务端自动引擎按截止日期重新计算。
  OVERDUE: new Set(['EXECUTING', 'SUSPENDED', 'REVIEWING', 'DELAYED', 'DELETED', 'DISABLED', 'NOT_SATISFIED']),
  DELAYED: new Set(['EXECUTING', 'SUSPENDED', 'REVIEWING', 'DELETED', 'DISABLED', 'NOT_SATISFIED']),
  SUSPENDED: new Set(['EXECUTING', 'DELETED', 'DISABLED']),
  REVIEWING: new Set(['COMPLETED', 'EXECUTING', 'DELETED', 'DISABLED']),
  COMPLETED: new Set(),
  ARCHIVED: new Set(),
  DELETED: new Set(['EXECUTING']),
  DISABLED: new Set(['EXECUTING']),
  NOT_SATISFIED: new Set(['EXECUTING', 'DELETED', 'DISABLED']),
};

export function isItemStatus(value: unknown): value is ItemStatus {
  return typeof value === 'string' && ITEM_STATUSES.has(value as ItemStatus);
}

export function canUserTransitionItemStatus(from: ItemStatus, to: ItemStatus): boolean {
  return from === to || USER_STATUS_TRANSITIONS[from].has(to);
}

