import { ItemStatus, SupervisionItem } from '../../../types';
import { getEffectiveItemStatus, getItemSignOffStatus, getUserIdentityKeys, identityMatches } from '../../../lib/item-format';
import type { User } from '../../../types';

export type WorkbenchMetricKey =
  | 'pendingOpen'
  | 'overdue'
  | 'noFeedback'
  | 'incomplete'
  | 'completed';

export type WorkbenchStatusMetric = {
  key: WorkbenchMetricKey;
  title: string;
  value: number;
  /** 副标题：单位/涉及事项说明。person 模式为「涉及 N 件督办」，item 模式为「督办事项」 */
  caption: string;
  /** 计数口径：person=按责任人任务数，item=按督办事项数 */
  mode: 'person' | 'item';
  path: string;
  params: string;
};

/** 是否存在反馈记录：lastFeedbackDate 或 FEEDBACK/FOLLOWER_FEEDBACK 时间轴节点（事项级，用于单责任人合成任务） */
function hasFeedback(item: SupervisionItem): boolean {
  return Boolean(
    item.lastFeedbackDate ||
      item.timeline?.some(node => node.type === 'FEEDBACK' || node.type === 'FOLLOWER_FEEDBACK'),
  );
}

/** 已关闭/办结状态：这些状态下即便时间轴无 SIGN 节点，也不应算作「待签收/未反馈/已超期」 */
const CLOSED_STATUSES = new Set(['COMPLETED', 'ARCHIVED', 'DISABLED', 'NOT_SATISFIED']);

/** 事项是否处于已关闭/办结态（基于有效状态） */
function isClosedItem(item: SupervisionItem): boolean {
  return CLOSED_STATUSES.has(getEffectiveItemStatus(item));
}

/**
 * 统计口径（黎处 2026-08-12 定义）：
 * 1. 待签收  = 含「本人未签收」责任人任务的事项
 * 2. 已超期  = 含「本人子任务 OVERDUE/DELAYED」的事项
 * 3. 未反馈  = 含「本人已签收且无反馈」责任人任务的事项（不含未签收责任人）
 * 4. 未完成  = 含「本人子任务非 COMPLETED」的事项
 * 5. 已完成  = 含「本人子任务 COMPLETED」的事项
 *
 * 口径要点：
 * - 生产首页恒传 currentUser（纯责任人视角），按【事项】计数：同一事项给该用户分配了
 *   多个子任务时也只计 1 条，故卡片数字 === 副标题「涉及 N 件督办」=== 下钻《督办事项》
 *   列表的行数（一行一事项），三者完全一致。
 * - 跨卡片重复仍保留：一件事项可同时命中「已超期」与「待签收」等多张卡片（不同卡片之间
 *   可重复计数，符合需求），这只是「不同卡片」维度的重复，不是「同一卡片内」的重复。
 */

/** 已签收的责任人姓名集合（来自 SIGN 时间轴节点 user） */
function signedOwnerNames(item: SupervisionItem): Set<string> {
  const set = new Set<string>();
  for (const node of item.timeline || []) {
    if (node.type === 'SIGN' && node.user && node.user.trim()) set.add(node.user.trim());
  }
  return set;
}

/** 已反馈的责任人姓名集合（来自 FEEDBACK 时间轴节点 user；跟进人反馈为 FOLLOWER_FEEDBACK，不计入责任人反馈） */
function feedbackOwnerNames(item: SupervisionItem): Set<string> {
  const set = new Set<string>();
  for (const node of item.timeline || []) {
    if (node.type === 'FEEDBACK' && node.user && node.user.trim()) set.add(node.user.trim());
  }
  return set;
}

/** 一个责任人任务：对应一名责任人的签收/反馈/状态 */
type PersonTask = {
  assigneeId?: string;
  name: string;
  signed: boolean;
  hasFeedback: boolean;
  status: ItemStatus;
};

/**
 * 把一条督办拆成若干「责任人任务」。
 * - 多责任人（有 subTasks）：每个 subTask 即一名责任人的任务，状态取 subTask.status，
 *   签收/反馈按责任人姓名匹配时间轴节点。
 * - 单责任人（无 subTasks 的兜底）：合成一个任务，状态取事项有效状态，反馈取事项级。
 */
function getPersonTasks(item: SupervisionItem): PersonTask[] {
  const signed = signedOwnerNames(item);
  const feedback = feedbackOwnerNames(item);

  const subTasks = (item.subTasks || []).filter(st => st.status !== 'DELETED');
  if (subTasks.length > 0) {
    return subTasks.map(st => {
      const name = (st.assigneeName || '').trim();
      // 优先采用后端基于【完整时间轴】算出的权威标记（signed/feedbackGiven），
      // 不再依赖被列表接口 slice(-5) 截断的展示时间轴；仅在离线/旧缓存缺字段时回退到时间轴推导。
      const stSigned = typeof st.signed === 'boolean'
        ? st.signed
        : (st.status !== 'PENDING' || (name ? signed.has(name) : false));
      const stHasFeedback = typeof st.feedbackGiven === 'boolean'
        ? st.feedbackGiven
        : (name ? feedback.has(name) : false);
      return {
        assigneeId: st.assigneeId,
        name,
        signed: stSigned,
        hasFeedback: stHasFeedback,
        status: st.status,
      };
    });
  }

  const name = (item.ownerName || (item.ownerNames && item.ownerNames[0]) || '').trim();
  const itemSigned = item.signOffStatus === 'SIGNED'
    ? true
    : (name ? signed.has(name) : getItemSignOffStatus(item).status === 'SIGNED');
  const itemHasFeedback = typeof item.hasFeedback === 'boolean'
    ? item.hasFeedback
    : hasFeedback(item);
  return [
    {
      name,
      signed: itemSigned,
      hasFeedback: itemHasFeedback,
      status: getEffectiveItemStatus(item),
    },
  ];
}

/** 五态卡片定义（标题与下钻参数固定，计数口径由 mode 决定） */
const METRIC_DEFS: Array<{ key: WorkbenchMetricKey; title: string; params: string }> = [
  { key: 'pendingOpen', title: '待签收', params: '?pendingOpen=1' },
  { key: 'overdue', title: '已超期', params: '?status=OVERDUE,DELAYED' },
  { key: 'noFeedback', title: '未反馈', params: '?noFeedback=1' },
  { key: 'incomplete', title: '未完成', params: '?incomplete=1' },
  { key: 'completed', title: '已完成', params: '?status=COMPLETED' },
];

/** 逐责任人命中谓词（person 口径核心） */
function personPredicate(key: WorkbenchMetricKey, pt: PersonTask, item: SupervisionItem): boolean {
  switch (key) {
    case 'pendingOpen':
      return !isClosedItem(item) && !pt.signed;
    case 'overdue':
      return !isClosedItem(item) && (pt.status === 'OVERDUE' || pt.status === 'DELAYED');
    case 'noFeedback':
      return !isClosedItem(item) && pt.signed && !pt.hasFeedback;
    case 'incomplete':
      return pt.status !== 'COMPLETED';
    case 'completed':
      return pt.status === 'COMPLETED';
  }
}

/** 逐事项命中谓词（item 口径核心，领导/管理员/跟进人视角） */
function itemPredicate(key: WorkbenchMetricKey, item: SupervisionItem): boolean {
  const effective = getEffectiveItemStatus(item);
  // 优先采用后端下发的权威签收/反馈标记（基于完整时间轴），避免被截断的展示时间轴导致误判。
  const signed = typeof item.signOffStatus === 'string'
    ? item.signOffStatus === 'SIGNED'
    : getItemSignOffStatus(item).status === 'SIGNED';
  const itemHasFeedback = typeof item.hasFeedback === 'boolean'
    ? item.hasFeedback
    : hasFeedback(item);
  switch (key) {
    case 'pendingOpen':
      return !isClosedItem(item) && !signed;
    case 'overdue':
      return !isClosedItem(item) && (effective === 'OVERDUE' || effective === 'DELAYED');
    case 'noFeedback':
      return !isClosedItem(item) && signed && !itemHasFeedback;
    case 'incomplete':
      return effective !== 'COMPLETED' && item.status !== 'DELETED';
    case 'completed':
      return effective === 'COMPLETED';
  }
}

/** 统一事项级命中谓词（与 item 模式计数同口径，供移动端首页标签及其下钻列表复用） */
export function isWorkbenchItemMetricMatch(key: WorkbenchMetricKey, item: SupervisionItem): boolean {
  return itemPredicate(key, item);
}

/**
 * 从某事项的责任人任务中筛出【当前用户自己】的那些。
 * 多责任人：按 id/name/username 匹配子任务责任人；单责任人兜底：匹配事项级 owner。
 * 与首页 person 模式 buildWorkbenchStatusMetrics 的过滤逻辑保持一致，保证计数口径统一。
 */
export function filterMyPersonTasks(item: SupervisionItem, user: Pick<User, 'id' | 'name' | 'username'>): PersonTask[] {
  const identities = getUserIdentityKeys(user);
  const pts = getPersonTasks(item);
  const hasSubTasks = (item.subTasks || []).some(st => st.status !== 'DELETED');

  if (hasSubTasks) {
    // 多责任人事项必须只按子任务自身的责任人身份匹配。
    // 事项级 ownerId 可能只是主责任人；若在这里兜底，会把同一事项中其他人的子任务一并计到主责任人名下。
    return pts.filter(pt =>
      identityMatches(pt.assigneeId, identities) || identityMatches(pt.name, identities),
    );
  }

  // 仅兼容没有有效 subTasks 的旧单责任人数据，使用事项级责任人字段兜底。
  const legacyOwnerIdentities = [
    item.ownerId,
    item.ownerName,
    ...(item.ownerIds || []),
    ...(item.ownerNames || []),
  ];
  return legacyOwnerIdentities.some(value => identityMatches(value, identities)) ? pts : [];
}

/**
 * 下钻列表用（责任人 ownerId=me 视角）：判断某事项是否命中指定卡片。
 * 与首页 person 模式对同一事项的计数口径完全一致 —— 只看下一个用户自己的责任人子任务，
 * 因此「首页卡片数字 N」与「下钻后事项列表条数 N」一一对应。
 *
 * @param key   五态卡片 key
 * @param item  事项
 * @param user  当前登录用户（ownerId=me 视角）
 */
export function isUserWorkbenchItem(key: WorkbenchMetricKey, item: SupervisionItem, user: Pick<User, 'id' | 'name' | 'username'>): boolean {
  const myPts = filterMyPersonTasks(item, user);
  return myPts.some(pt => personPredicate(key, pt, item));
}

/**
 * 构建五态卡片指标。
 * @param items 已按当前用户可见范围过滤后的事项
 * @param mode  'person'（默认，责任人任务数，用于纯责任人视角）/ 'item'（督办事项数，用于领导/管理员/跟进人视角）
 * @param currentUser person 模式下必传，用于只统计当前登录用户自己的责任人任务；item 模式下忽略
 *
 * person 模式（传入 currentUser，即生产首页场景）：value=命中该卡的【去重事项数】，
 *   与该卡副标题「涉及 N 件督办」一致，也与下钻《督办事项》列表「一行一事项」的条数完全一致
 *   （同一事项给当前用户分配多个子任务时只计 1 条，不再被灌高）。
 * person 模式（未传 currentUser，仅历史/测试兼容）：value=责任人任务数（同一事项可计多次），保留旧语义。
 * item   模式：value=督办事项数（每块最多 1），caption=`督办事项`。
 */
export function buildWorkbenchStatusMetrics(
  items: SupervisionItem[],
  mode: 'person' | 'item' = 'person',
  currentUser?: Pick<User, 'id' | 'name' | 'username'>,
): WorkbenchStatusMetric[] {
  const active = items.filter(item => item.status !== 'DELETED');

  if (mode === 'item') {
    return METRIC_DEFS.map(def => ({
      key: def.key,
      title: def.title,
      value: active.filter(item => itemPredicate(def.key, item)).length,
      caption: '督办事项',
      mode: 'item' as const,
      path: '/items',
      params: def.params,
    }));
  }

  // person 模式：遍历每件事项，只累加【当前用户自己的】责任人任务的命中，并记录命中的事项集合
  const acc: Record<WorkbenchMetricKey, { value: number; itemIds: Set<string> }> = {
    pendingOpen: { value: 0, itemIds: new Set() },
    overdue: { value: 0, itemIds: new Set() },
    noFeedback: { value: 0, itemIds: new Set() },
    incomplete: { value: 0, itemIds: new Set() },
    completed: { value: 0, itemIds: new Set() },
  };

  for (const item of active) {
    const pts = currentUser ? filterMyPersonTasks(item, currentUser) : getPersonTasks(item);
    for (const def of METRIC_DEFS) {
      const matched = pts.filter(pt => personPredicate(def.key, pt, item));
      if (matched.length > 0) {
        // 传入 currentUser（生产首页场景）时，按「事项」计数：同一事项即便给该用户分配了多个
        // 子任务，也只计为 1 条，与下钻《督办事项》列表「一行一事项」的条数完全一致，
        // 根治「首页数字 > 下钻条数」的统计错位（贺诗然账号暴露的真实场景）。
        // 未传 currentUser 时保留旧语义（按责任人任务数计数，向后兼容历史调用方）。
        acc[def.key].value += currentUser ? 1 : matched.length;
        acc[def.key].itemIds.add(item.id);
      }
    }
  }

  return METRIC_DEFS.map(def => ({
    key: def.key,
    title: def.title,
    value: acc[def.key].value,
    caption: `涉及 ${acc[def.key].itemIds.size} 件督办`,
    mode: 'person' as const,
    path: '/items',
    params: def.params,
  }));
}

/* ---------------------- 以下为事项列表下钻谓词（按事项过滤，保持原有行为不变） ---------------------- */

/** 待签收下钻谓词（事项级，供列表 ?pendingOpen=1）：签收状态「未全部签收」。卡片数字按责任人计数，下钻列表仍按事项过滤。 */
export function isWorkbenchPendingOpenItem(item: SupervisionItem): boolean {
  if (CLOSED_STATUSES.has(getEffectiveItemStatus(item))) return false;
  const signed = typeof item.signOffStatus === 'string'
    ? item.signOffStatus === 'SIGNED'
    : getItemSignOffStatus(item).status === 'SIGNED';
  return !signed;
}

/** 未反馈（事项级，供列表下钻 ?noFeedback=1）：全部签收且无反馈记录。 */
export function isWorkbenchNoFeedbackItem(item: SupervisionItem): boolean {
  if (CLOSED_STATUSES.has(getEffectiveItemStatus(item))) return false;
  const signed = typeof item.signOffStatus === 'string'
    ? item.signOffStatus === 'SIGNED'
    : getItemSignOffStatus(item).status === 'SIGNED';
  const itemHasFeedback = typeof item.hasFeedback === 'boolean'
    ? item.hasFeedback
    : hasFeedback(item);
  return signed && !itemHasFeedback;
}

/** 未完成（事项级，供列表下钻 ?incomplete=1）：有效状态非「已办结」。 */
export function isWorkbenchIncompleteItem(item: SupervisionItem): boolean {
  const status = getEffectiveItemStatus(item);
  return status !== 'COMPLETED' && item.status !== 'DELETED';
}
