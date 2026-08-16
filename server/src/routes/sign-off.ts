/**
 * 督办签收状态聚合逻辑
 *
 * 业务规则（各责任人独立签收，互不干扰）：
 * 一条督办事项可关联多名责任人（ownerNames）。每名责任人各自完成「签收」操作，
 * 任一责任人的签收 / 反馈仅反映其本人状态，不影响其他责任人，也不阻塞事项整体推进。
 * - 0 人签收 → 未签收(NOT_SIGNED)；
 * - 部分责任人签收 → 部分签收(PARTIAL)；
 * - 全部关联责任人均已完成签收 → 已签收(SIGNED)；
 * - 无关联责任人时视为已签收（无待签收对象）。
 *
 * 签收行为在服务端以 timeline_nodes 中 type='SIGN'、user=责任人姓名 的节点记录，
 * 因此「某责任人是否已签收」通过时间轴 SIGN 节点是否包含其姓名来判定。
 */

export type SignOffStatusValue = 'SIGNED' | 'NOT_SIGNED' | 'PARTIAL';

export interface SignOffStatus {
  status: SignOffStatusValue;
  /** 已完成签收的责任人数量 */
  signedCount: number;
  /** 关联责任人总数 */
  totalCount: number;
}

interface OwnerLikeItem {
  ownerId?: string | null;
  ownerName?: string | null;
  ownerIds?: unknown;
  ownerNames?: unknown;
  subTasks?: unknown;
  timeline?: unknown;
}

interface TimelineLikeNode {
  type?: unknown;
  user?: unknown;
  actorUserId?: unknown;
}

interface SubTaskLike {
  assigneeId?: unknown;
  assigneeName?: unknown;
  status?: unknown;
}

function getItemOwners(item: OwnerLikeItem): Array<{ id?: string; name?: string }> {
  const ids = Array.isArray(item.ownerIds) ? item.ownerIds : [];
  const names = Array.isArray(item.ownerNames) ? item.ownerNames : [];
  const count = Math.max(ids.length, names.length, item.ownerId || item.ownerName ? 1 : 0);
  const owners = Array.from({ length: count }, (_, index) => ({
    id: typeof ids[index] === 'string' ? ids[index] : index === 0 && item.ownerId ? item.ownerId : undefined,
    name: typeof names[index] === 'string' ? names[index] : index === 0 && item.ownerName ? item.ownerName : undefined,
  }));
  return owners.filter((owner) => owner.id || owner.name);
}

/** 提取事项关联的全部责任人姓名（去重、去空）。注意只取姓名，不含 ID。 */
export function getItemOwnerNames(item: OwnerLikeItem): string[] {
  const names = new Set<string>();
  const pushName = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) names.add(value.trim());
  };
  pushName(item.ownerName);
  if (Array.isArray(item.ownerNames)) {
    item.ownerNames.forEach(pushName);
  }
  return [...names];
}

/** 从时间轴节点中提取已完成签收的责任人姓名集合。 */
export function getSignedOwnerNames(timeline: unknown): Set<string> {
  const set = new Set<string>();
  if (!Array.isArray(timeline)) return set;
  for (const node of timeline as TimelineLikeNode[]) {
    if (node && node.type === 'SIGN' && typeof node.user === 'string' && node.user.trim()) {
      set.add(node.user.trim());
    }
  }
  return set;
}

function findOwnerSubTask(subTasks: SubTaskLike[], owner: { id?: string; name?: string }): SubTaskLike | undefined {
  if (owner.id) {
    const byId = subTasks.find((task) => task.assigneeId === owner.id);
    if (byId) return byId;
  }
  if (owner.name) {
    return subTasks.find((task) => task.assigneeName === owner.name);
  }
  return undefined;
}

function isSignedSubTaskStatus(status: unknown): boolean {
  return typeof status === 'string' && status !== 'PENDING' && status !== 'DELETED';
}

/**
 * 计算事项的签收状态（各责任人独立，互不干扰）。
 * - 无关联责任人时视为「已签收」（无待签收对象）。
 * - 0 人签收 → NOT_SIGNED；部分签收 → PARTIAL；全部签收 → SIGNED。
 */
export function computeSignOffStatus(item: OwnerLikeItem, timeline?: unknown): SignOffStatus {
  const owners = getItemOwners(item);
  const tl = timeline ?? (Array.isArray(item.timeline) ? item.timeline : []);
  const signNodes = (Array.isArray(tl) ? tl : []).filter((node: TimelineLikeNode) => node?.type === 'SIGN');
  const signedNamesWithoutActorId = new Set(signNodes
    .filter((node: TimelineLikeNode) => typeof node.user === 'string' && node.user.trim() && typeof node.actorUserId !== 'string')
    .map((node: TimelineLikeNode) => (node.user as string).trim()));
  const signedIds = new Set(signNodes
    .filter((node: TimelineLikeNode) => node?.type === 'SIGN' && typeof node.actorUserId === 'string')
    .map((node: TimelineLikeNode) => node.actorUserId as string));
  const subTasks = Array.isArray(item.subTasks) ? item.subTasks as SubTaskLike[] : [];
  const signedCount = owners.filter((owner) => {
    const ownerSubTask = findOwnerSubTask(subTasks, owner);
    if (ownerSubTask) {
      // 多责任人已拆分子任务时，子任务状态是签收事实的权威来源；
      // 时间轴只作审计留痕，不能覆盖仍处于 PENDING 的责任人子任务。
      return isSignedSubTaskStatus(ownerSubTask.status);
    }

    if (owner.id && signedIds.has(owner.id)) return true;
    if (owner.name && signedNamesWithoutActorId.has(owner.name)) return true;

    return false;
  }).length;
  const totalCount = owners.length;
  let status: SignOffStatusValue;
  if (totalCount === 0) {
    status = 'SIGNED';
  } else if (signedCount === 0) {
    status = 'NOT_SIGNED';
  } else if (signedCount === totalCount) {
    status = 'SIGNED';
  } else {
    status = 'PARTIAL';
  }
  return { status, signedCount, totalCount };
}

/**
 * 判断某次签收操作完成后，是否所有责任人均已完成签收。
 * 注意：签收不再统一门控事项生命周期，各责任人可独立签收、互不影响；
 * 本函数仅作为统计 / 辅助判断使用（如判断「是否全部签收」）。
 *
 * @param item           当前事项（含 ownerName/ownerNames）
 * @param existingTimeline 已有的时间轴节点（来自 timeline_nodes 表）
 * @param incomingTimeline 本次请求携带的新增时间轴节点（含本次 SIGN 节点）
 * @param actorName      执行本次签收操作的责任人姓名
 */
export function allOwnersSignedAfter(
  item: OwnerLikeItem,
  existingTimeline: unknown,
  incomingTimeline: unknown,
  actorName?: string | null,
): boolean {
  const owners = getItemOwnerNames(item);
  if (owners.length === 0) return true;
  const signed = new Set<string>([
    ...getSignedOwnerNames(existingTimeline),
    ...getSignedOwnerNames(incomingTimeline),
  ]);
  if (actorName && actorName.trim()) signed.add(actorName.trim());
  return owners.every((name) => signed.has(name));
}
