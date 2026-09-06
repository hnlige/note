import { ItemStatus, SubTask, SupervisionItem, TimelineNode, User } from '../types';

export function formatDate(value?: string | Date | null): string {
  if (!value) return '-';

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '-' : toDateString(value);
  }

  const raw = String(value).trim();
  if (!raw) return '-';

  // 匹配 YYYY-MM-DD 开头的日期格式（包括 ISO 格式如 2026-06-16T00:00:00.000Z）
  const dateOnlyMatch = raw.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (dateOnlyMatch) return `${dateOnlyMatch[1]}/${dateOnlyMatch[2]}/${dateOnlyMatch[3]}`;

  // 尝试解析为 Date 对象
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return toDateString(parsed);
}

/**
 * 将时间戳格式化为「日期 + 时间」(本地时区)，例如 2026-08-07T07:37:20.000Z -> 2026-08-07 15:37。
 * 用于催办记录、时间轴等需要展示具体时刻的场景，避免直接显示原始 ISO 字符串。
 */
function formatDateObj(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 将日期值格式化为本地可读的 "YYYY-MM-DD HH:mm"。
 * - 已是可读格式（如后端 formatTimestamp 产出的 "YYYY-MM-DD HH:mm:ss"、前端 toLocaleString 的
 *   "2026/8/7 15:37:20"）直接原样返回，避免重复解析造成的时区/格式偏差；
 * - 后端以 ISO（含 T/Z，如 "2026-08-07T07:37:20.000Z"）返回的字符串，按本地时区转换为可读格式；
 * - 空值 / 无法解析的值返回 "-"。
 */
export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '-';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '-' : formatDateObj(value);
  }
  const s = String(value).trim();
  if (!s) return '-';
  // 仅严格匹配后端预格式化的 YYYY-MM-DD HH:mm:ss 或 YYYY-MM-DD HH:mm（横杠、两位数月日）才原样返回；
  // 斜杠格式(如 toLocaleString 输出 2026/8/9 22:26:30)及其他非标准格式均重新解析并统一规范化。
  if (!/[TZ]/.test(s) && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(s)) {
    return s;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return formatDateObj(d);
}

export function todayDateString(now = new Date()): string {
  return toDateString(now);
}

export function normalizeManualDateInput(value?: string | null): string {
  if (!value) return '';
  const normalized = String(value).trim().replace(/[.-]/g, '/').replace(/\s+/g, '');
  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return value.trim();

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return value.trim();
  }

  return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
}

export function isValidManualDateInput(value?: string | null): boolean {
  if (!value) return false;
  return /^\d{4}\/\d{2}\/\d{2}$/.test(normalizeManualDateInput(value));
}

export function isManualDateOnOrAfter(value: string, min: string): boolean {
  if (!isValidManualDateInput(value) || !isValidManualDateInput(min)) return false;
  return normalizeManualDateInput(value) >= normalizeManualDateInput(min);
}

const FINAL_ITEM_STATUSES: ItemStatus[] = ['COMPLETED', 'ARCHIVED', 'DISABLED', 'DELETED', 'NOT_SATISFIED'];

function isFinalItemStatus(status: ItemStatus): boolean {
  return FINAL_ITEM_STATUSES.includes(status);
}

/**
 * 计算事项的签收状态（各责任人独立，互不干扰）。
 * 业务规则：多责任人场景下，0 人签收 → NOT_SIGNED；部分签收 → PARTIAL；
 * 全部签收 → SIGNED。无关联责任人时视为 SIGNED。
 */
export function getItemSignOffStatus(item: SupervisionItem): {
  status: 'SIGNED' | 'NOT_SIGNED' | 'PARTIAL';
  signedCount: number;
  totalCount: number;
} {
  const ownerIds = item.ownerIds || [];
  const ownerNames = item.ownerNames || [];
  const ownerCount = Math.max(ownerIds.length, ownerNames.length, item.ownerId || item.ownerName ? 1 : 0);
  const owners = Array.from({ length: ownerCount }, (_, index) => ({
    id: ownerIds[index] || (index === 0 ? item.ownerId : undefined),
    name: ownerNames[index] || (index === 0 ? item.ownerName : undefined),
  })).filter((owner) => owner.id || owner.name);
  const totalCount = owners.length;
  const signedNamesWithoutActorId = new Set<string>();
  for (const node of item.timeline || []) {
    if (node.type === 'SIGN' && node.user && node.user.trim() && !node.actorUserId) {
      signedNamesWithoutActorId.add(node.user.trim());
    }
  }
  const signedIds = new Set((item.timeline || [])
    .filter((node) => node.type === 'SIGN' && node.actorUserId)
    .map((node) => node.actorUserId as string));
  const signedCount = owners.filter((owner) => {
    const ownerSubTask = item.subTasks?.find((task) => {
      if (owner.id && task.assigneeId === owner.id) return true;
      return Boolean(owner.name && task.assigneeName === owner.name);
    });
    if (ownerSubTask) {
      if (ownerSubTask.status === 'PENDING' || ownerSubTask.status === 'DELETED') return false;
      const signedByTimeline = (owner.id && signedIds.has(owner.id)) || (owner.name && signedNamesWithoutActorId.has(owner.name));
      // 历史数据缺少 SIGN 时，仅已有计划完成日期的非 PENDING 子任务兼容为已签收；
      // 无 SIGN 且无计划日期通常是旧版反馈自动签收遗留，仍应保留待签收。
      return Boolean(signedByTimeline || String(ownerSubTask.plannedCompletionDate || '').trim());
    }

    if (owner.id && signedIds.has(owner.id)) return true;
    if (owner.name && signedNamesWithoutActorId.has(owner.name)) return true;
    return false;
  }).length;
  let status: 'SIGNED' | 'NOT_SIGNED' | 'PARTIAL';
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

export function getEffectiveItemStatus(item: SupervisionItem): ItemStatus {
  // 状态由后端统一推导并下发。前端不再根据时间轴文案或子任务重复计算父事项状态。
  // effectiveStatus 缺失时仅回退到持久化 status，兼容旧缓存和本地模拟数据。
  return item.effectiveStatus || item.status;
}

function normalizeIdentity(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

export function identityMatches(value: string | undefined | null, identities: string[]): boolean {
  const normalized = normalizeIdentity(value);
  return Boolean(normalized && identities.includes(normalized));
}

export function getUserIdentityKeys(user: Pick<User, 'id' | 'name' | 'username'>): string[] {
  return [...new Set([user.id, user.name, user.username].map(normalizeIdentity).filter(Boolean))];
}

export function isItemOwnerForUser(item: SupervisionItem, user: Pick<User, 'id' | 'name' | 'username'>): boolean {
  const identities = getUserIdentityKeys(user);
  return [item.ownerId, ...(item.ownerIds || []), item.ownerName, ...(item.ownerNames || [])]
    .some(value => identityMatches(value, identities)) ||
    Boolean(item.subTasks?.some(task => identityMatches(task.assigneeId, identities) || identityMatches(task.assigneeName, identities)));
}

export function isItemFollowerForUser(item: SupervisionItem, user: Pick<User, 'id' | 'name' | 'username'>): boolean {
  const identities = getUserIdentityKeys(user);
  return [item.followerId, ...(item.followerIds || []), item.followerName, ...(item.followerNames || [])]
    .some(value => identityMatches(value, identities));
}

/** 当前用户是否「与事项相关」：作为责任人和/或跟进人。工作台卡片(FOLLOWER 收窄)与 /items?scope=mine 下钻共用，保证口径一致。 */
export function isItemRelatedToUser(item: SupervisionItem, user: Pick<User, 'id' | 'name' | 'username'>): boolean {
  const identities = getUserIdentityKeys(user);
  const isShared = (item.sharedWith || []).some((shared) =>
    identityMatches(shared.userId, identities) || identityMatches(shared.userName, identities),
  );
  return isItemOwnerForUser(item, user) || isItemFollowerForUser(item, user) || isShared;
}

/** 移动端事项状态：责任人按本人子任务，其余相关人员按事项聚合状态。 */
export function getMobileItemStatus(
  item: SupervisionItem,
  user: Pick<User, 'id' | 'name' | 'username'>,
): ItemStatus {
  return isItemOwnerForUser(item, user)
    ? getEffectiveStatusForUserIdentity(item, user)
    : getEffectiveItemStatus(item);
}

export function getUserSubTask(item: SupervisionItem, userId: string): SubTask | undefined {
  return item.subTasks?.find(task => task.assigneeId === userId);
}

export function getUserSubTaskForIdentity(item: SupervisionItem, user: Pick<User, 'id' | 'name' | 'username'>): SubTask | undefined {
  const identities = getUserIdentityKeys(user);
  return item.subTasks?.find(task => identityMatches(task.assigneeId, identities) || identityMatches(task.assigneeName, identities));
}

export function getEffectiveStatusForUser(item: SupervisionItem, userId: string): ItemStatus {
  if (isFinalItemStatus(item.status)) return item.status;
  const subTask = getUserSubTask(item, userId);
  return subTask?.status || getEffectiveItemStatus(item);
}

export function getEffectiveStatusForUserIdentity(item: SupervisionItem, user: Pick<User, 'id' | 'name' | 'username'>): ItemStatus {
  if (isFinalItemStatus(item.status)) return item.status;
  const subTask = getUserSubTaskForIdentity(item, user);
  if (!subTask) return getEffectiveItemStatus(item);
    if (subTask.status !== 'PENDING' && subTask.status !== 'DELETED' && !String(subTask.plannedCompletionDate || '').trim()) {
    const identities = getUserIdentityKeys(user);
    const signedByTimeline = (item.timeline || []).some((node) =>
      node.type === 'SIGN' && (
        identityMatches(node.actorUserId, identities) || identityMatches(node.user, identities)
      ),
    );
    if (!signedByTimeline) return 'PENDING';
  }
  return subTask.status;
}

/**
 * 催办时间轴内容展示：历史数据以 `(SYSTEM)` 等英文枚举结尾，统一替换为中文
 * （站内推送/消息通知/电话催办），与新数据（服务端已直接写入中文）保持一致。
 */
export function formatUrgeTimelineContent(content?: string | null): string {
  const value = String(content || '');
  return value.replace(/ ?[(（](SYSTEM|MESSAGE|PHONE)[)）]/g, (_match, method: string) => {
    if (method === 'SYSTEM') return '（站内推送）';
    if (method === 'PHONE') return '（电话催办）';
    return '（消息通知）';
  });
}

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

export function updateUserSubTask(
  item: SupervisionItem,
  userId: string,
  updates: Partial<SubTask>,
): { subTasks?: SubTask[]; status?: ItemStatus } {
  if (!item.subTasks?.length) return {};

  const subTasks = item.subTasks.map(task =>
    task.assigneeId === userId ? { ...task, ...updates } : task
  );

  return {
    subTasks,
    status: aggregateSubTaskStatus(subTasks),
  };
}

export function updateUserSubTaskForIdentity(
  item: SupervisionItem,
  user: Pick<User, 'id' | 'name' | 'username'>,
  updates: Partial<SubTask>,
): { subTasks?: SubTask[]; status?: ItemStatus } {
  if (!item.subTasks?.length) return {};

  const identities = getUserIdentityKeys(user);
  const subTasks = item.subTasks.map(task =>
    identityMatches(task.assigneeId, identities) || identityMatches(task.assigneeName, identities) ? { ...task, ...updates } : task
  );

  return {
    subTasks,
    status: aggregateSubTaskStatus(subTasks),
  };
}

/**
 * 跟进人父级操作（暂缓/废弃/重启/整体完成）同步到全部子任务。
 * 多责任人场景下，父级操作对所有子集生效；单责任人（无子任务）则直接作用于事项本身。
 */
export function syncAllSubTasks(
  item: SupervisionItem,
  updates: Partial<SubTask>,
  options: { preserveFinal?: boolean } = {},
): { subTasks?: SubTask[]; status?: ItemStatus } {
  if (!item.subTasks?.length) return {};
  const subTasks = item.subTasks.map((task) => {
    if (options.preserveFinal && (task.status === 'COMPLETED' || task.status === 'ARCHIVED' || task.status === 'DELETED')) {
      return task;
    }
    return { ...task, ...updates };
  });
  return {
    subTasks,
    status: aggregateSubTaskStatus(subTasks),
  };
}

export function getUniqueTimeline(timeline: TimelineNode[] = []): TimelineNode[] {
  const seen = new Set<string>();

  return timeline.filter((node) => {
    const attachmentKey = (node.attachments || [])
      .map(att => [att.id, att.name, att.url, att.size, att.type].map(normalizeText).join('::'))
      .join(';;');
    const key = [
      node.type,
      node.user,
      node.content,
      node.timestamp,
      attachmentKey,
    ].map(normalizeText).join('|');

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getItemStatusLabel(status: string): string {
  switch (status) {
    case 'PENDING': return '待签收';
    case 'EXECUTING': return '执行中';
    case 'OVERDUE': return '已超时';
    case 'DELAYED': return '已延期';
    case 'SUSPENDED': return '已暂缓';
    case 'COMPLETED': return '已正常完成';
    case 'ARCHIVED': return '已归档';
    case 'DELETED': return '已删除';
    case 'DISABLED': return '已废弃';
    case 'NOT_SATISFIED': return '未按要求完成';
    case 'REVIEWING': return '待审批完成';
    default: return status;
  }
}

export function getSignOffStatusLabel(status?: string): string {
  if (status === 'SIGNED') return '已签收';
  if (status === 'PARTIAL') return '部分签收';
  return '未签收';
}

export function getSignOffStatusStyle(status?: string): string {
  if (status === 'SIGNED') return 'bg-green-50 text-green-600';
  if (status === 'PARTIAL') return 'bg-orange-50 text-orange-600';
  return 'bg-amber-50 text-amber-600';
}

export function getItemStatusStyle(status: string): string {
  switch (status) {
    case 'PENDING': return 'bg-slate-100 text-slate-600';
    case 'EXECUTING': return 'bg-blue-50 text-blue-600';
    case 'OVERDUE': return 'bg-red-50 text-red-600';
    case 'DELAYED': return 'bg-orange-50 text-orange-600';
    case 'SUSPENDED': return 'bg-gray-100 text-gray-600';
    case 'COMPLETED': return 'bg-green-50 text-green-600';
    case 'ARCHIVED': return 'bg-purple-50 text-purple-600';
    case 'DELETED': return 'bg-red-100 text-red-500 line-through';
    case 'DISABLED': return 'bg-gray-100 text-gray-500';
    case 'NOT_SATISFIED': return 'bg-yellow-50 text-yellow-600';
    case 'REVIEWING': return 'bg-amber-50 text-amber-600';
    default: return 'bg-slate-100 text-slate-600';
  }
}

function normalizeText(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function toDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 将日期字符串解析为时间戳（毫秒）。解析失败时返回 0（视为最早）。
 * 兼容 "YYYY-MM-DD"、"YYYY/MM/DD" 以及带时分秒的 ISO 字符串。
 */
function parseDateToTime(value?: string | null): number {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * 督办事项按"提出时间"倒序（最新在最前）比较器；
 * 提出时间缺失时回退到截止日期，确保缺值项稳稳定位在底部。
 * 用于列表默认排序：最新日期的督办排在最上方。
 */
export function compareItemsByRaiseDateDesc(a: SupervisionItem, b: SupervisionItem): number {
  const ta = a.raiseDate ? parseDateToTime(a.raiseDate) : parseDateToTime(a.deadline);
  const tb = b.raiseDate ? parseDateToTime(b.raiseDate) : parseDateToTime(b.deadline);
  return tb - ta;
}
