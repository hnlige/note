/**
 * 督办事项「有效状态」计算（后端纯净实现）。
 *
 * 后端是有效状态的权威计算端，列表/详情接口通过 effectiveStatus 下发结果。
 * 前端 `src/lib/item-format.ts` 仅对旧缓存/离线数据保留兼容性推导。
 * 签收相关判定复用后端 `sign-off.ts` 的 `computeSignOffStatus`。
 */

import { ItemStatus, SubTask, SupervisionItem } from '../types';

const FINAL_ITEM_STATUSES: ItemStatus[] = [
  'COMPLETED',
  'ARCHIVED',
  'DISABLED',
  'DELETED',
  'NOT_SATISFIED',
];

function isFinalItemStatus(status: ItemStatus): boolean {
  return FINAL_ITEM_STATUSES.includes(status);
}

/**
 * 子任务状态聚合为父事项状态。
 * 优先级：已超时 > 待审批完成 > 已暂缓 > 已延期 > 执行中 > 待签收 > 未按要求完成 > 已废弃 > 全部完成/归档。
 */
export function aggregateSubTaskStatus(subTasks: SubTask[]): ItemStatus {
  const statuses = subTasks.map(task => task.status).filter(status => status !== 'DELETED');
  if (statuses.length === 0) return 'PENDING';

  if (statuses.some(status => status === 'OVERDUE')) return 'OVERDUE';
  if (statuses.some(status => status === 'REVIEWING')) return 'REVIEWING';
  if (statuses.some(status => status === 'SUSPENDED')) return 'SUSPENDED';
  if (statuses.some(status => status === 'DELAYED')) return 'DELAYED';
  if (statuses.some(status => status === 'EXECUTING')) return 'EXECUTING';
  if (statuses.some(status => status === 'PENDING')) return 'PENDING';
  if (statuses.some(status => status === 'NOT_SATISFIED')) return 'NOT_SATISFIED';
  if (statuses.some(status => status === 'DISABLED')) return 'DISABLED';
  if (statuses.every(status => status === 'COMPLETED' || status === 'ARCHIVED')) return 'COMPLETED';
  return statuses[0] || 'PENDING';
}

/**
 * 终审办结后的父事项状态。
 * 无活动子任务（单责任人事项）终审即整体办结——聚合空子任务会误回退「待签收」，
 * 导致单责任人审批链永远无法办结；有子任务时维持最差状态聚合，
 * 未走到终审的责任人子任务不受影响。
 */
export function resolveFinalApprovalStatus(subTasks: SubTask[]): ItemStatus {
  const active = subTasks.filter(task => task.status !== 'DELETED');
  if (active.length === 0) return 'COMPLETED';
  return aggregateSubTaskStatus(subTasks);
}

/**
 * 计算事项的「有效状态」。
 * 规则：
 * 1. 终态（已办结/已归档/已废弃/已删除/未按要求完成）直接返回；
 * 2. 待审批完成(REVIEWING) 直接返回；
 * 3. 含子任务时由子任务聚合；
 * 4. 非待签收状态直接返回原始状态；
 * 5. 待签收(PENDING) 时按签收/反馈推导：任一名责任人签收或反馈即视为已开始执行，各责任人独立、互不影响。
 */
/**
 * 判断责任人本次受信任的业务活动是否应将未启动或历史超期事项推进为“执行中”。
 *
 * 状态推进只认服务端已校验的 SIGN / FEEDBACK 事件；跟进人反馈会在路由层转为
 * FOLLOWER_FEEDBACK，不能触发责任人事项的启动。OVERDUE 恢复为 EXECUTING 后，
 * 是否仍超期仍由服务端自动引擎按截止日期重新计算。
 */
export function shouldStartPendingItemAfterOwnerActivity(
  currentStatus: ItemStatus,
  timelineTypes: Array<string | undefined>,
): boolean {
  return ['PENDING', 'OVERDUE'].includes(currentStatus)
    && timelineTypes.some((type) => type === 'SIGN' || type === 'FEEDBACK');
}

/**
 * 统一计算写库状态。
 *
 * - 终态和审批态由明确业务分支写入，不做隐式覆盖；
 * - 有子任务时，父事项通常由子任务聚合；
 * - 单责任人无子任务时，责任人的受信任签收/反馈将 PENDING 或 OVERDUE 推进为 EXECUTING；
 * - 其余场景保留路由业务分支已经决定的状态。
 */
export function derivePersistedItemStatus(input: {
  currentStatus: ItemStatus;
  requestedStatus?: ItemStatus;
  subTasks?: SubTask[];
  ownerActivityTimelineTypes?: Array<string | undefined>;
}): ItemStatus {
  const requestedStatus = input.requestedStatus || input.currentStatus;

  // 父级废弃、审批和终态必须优先于聚合生效；对应子任务同步由路由业务分支保证。
  if (isFinalItemStatus(requestedStatus) || requestedStatus === 'REVIEWING') {
    return requestedStatus;
  }

  if (input.subTasks?.length) {
    return aggregateSubTaskStatus(input.subTasks);
  }

  return shouldStartPendingItemAfterOwnerActivity(
    input.currentStatus,
    input.ownerActivityTimelineTypes || [],
  )
    ? 'EXECUTING'
    : requestedStatus;
}

export function getEffectiveItemStatus(item: SupervisionItem): ItemStatus {
  if (isFinalItemStatus(item.status)) {
    return item.status;
  }

  if (item.status === 'REVIEWING') {
    return 'REVIEWING';
  }

  if (item.subTasks?.length) {
    return aggregateSubTaskStatus(item.subTasks);
  }

  if (!['PENDING', 'OVERDUE'].includes(item.status)) return item.status;

  // 签收/反馈即视为事项已开始执行：单责任人与多责任人均按「任一人签收或反馈」独立推进，
  // 不再要求全部责任人签收才进入执行中（各责任人签收/反馈互不干扰）。
  const hasStarted = (item.timeline || []).some(
    node => node.type === 'SIGN' || node.type === 'FEEDBACK',
  );
  return hasStarted ? 'EXECUTING' : item.status;
}
