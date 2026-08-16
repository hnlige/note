/**
 * 工作台状态筛选标签「展示数 vs 真实数」校验器（超级管理员 / 领导 / 跟进人视角，事项维度）。
 *
 * 设计目标：
 * 以督办系统中「各状态筛选标签」为对象，校验其【展示数量】是否与【按规范口径查询所得真实数量】一致。
 *
 * 计数口径（黎处 2026-08-12 调整，与前端 MetricCards 的 item 模式一致）：
 *   - 领导/管理员/跟进人登录工作台首页时，卡片按「督办事项数」计数（每件督办最多计 1）。
 *   - 纯责任人(SELF)登录时卡片按「责任人任务数」计数（person 模式）；该个人工作台不在本对账范围。
 * 本模块复刻「管理员/领导/跟进人视角（事项维度）」的前端实现，对展示数与真实数做逐项比对。
 *
 * 规范口径（事项级，每块最多 1）：
 *   - 待签收：签收状态「未全部签收」（signOffStatus !== SIGNED），排除关闭/办结状态
 *   - 已超期：有效状态为 OVERDUE/DELAYED，排除关闭/办结状态
 *   - 未反馈：签收状态为 SIGNED 且不存在任何反馈记录，排除关闭/办结状态
 *   - 未完成：有效状态非 COMPLETED（排除已删除 DELETED）
 *   - 已完成：有效状态为 COMPLETED
 */

import { ItemStatus, SupervisionItem } from '../types';
import { getEffectiveItemStatus } from './item-effective-status';

/** 经列表接口附加后的事项：含 timeline、signOffStatus 等计算字段 */
export type EnrichedItem = SupervisionItem & {
  timeline?: Array<{ type?: string; user?: string; content?: string; timestamp?: string }>;
  signOffStatus?: 'SIGNED' | 'NOT_SIGNED' | 'PARTIAL';
  signedOwnerCount?: number;
  totalOwnerCount?: number;
};

/** 是否存在反馈记录：lastFeedbackDate 或 FEEDBACK/FOLLOWER_FEEDBACK 时间轴节点（事项级） */
function hasFeedback(item: EnrichedItem): boolean {
  return Boolean(
    (item as unknown as Record<string, unknown>).lastFeedbackDate ||
      item.timeline?.some(node => node.type === 'FEEDBACK' || node.type === 'FOLLOWER_FEEDBACK'),
  );
}

/** 已关闭/办结状态：这些状态下即便时间轴无 SIGN 节点，也不应算作「待签收/未反馈/已超期」 */
const CLOSED_STATUSES = new Set<ItemStatus>(['COMPLETED', 'ARCHIVED', 'DISABLED', 'NOT_SATISFIED']);

function isClosedItem(item: EnrichedItem): boolean {
  return CLOSED_STATUSES.has(getEffectiveItemStatus(item));
}

/** 事项级命中谓词（复刻前端 itemPredicate / isWorkbench*Item） */
function isPendingOpen(item: EnrichedItem): boolean {
  if (isClosedItem(item)) return false;
  const so = (item.signOffStatus as 'SIGNED' | 'NOT_SIGNED' | 'PARTIAL' | undefined) ||
    require_signoff_status(item);
  return so !== 'SIGNED';
}
function isOverdue(item: EnrichedItem): boolean {
  const s = getEffectiveItemStatus(item);
  return !isClosedItem(item) && (s === 'OVERDUE' || s === 'DELAYED');
}
function isNoFeedback(item: EnrichedItem): boolean {
  if (isClosedItem(item)) return false;
  const so = (item.signOffStatus as 'SIGNED' | 'NOT_SIGNED' | 'PARTIAL' | undefined) ||
    require_signoff_status(item);
  return so === 'SIGNED' && !hasFeedback(item);
}
function isIncomplete(item: EnrichedItem): boolean {
  const s = getEffectiveItemStatus(item);
  return s !== 'COMPLETED' && item.status !== 'DELETED';
}
function isCompleted(item: EnrichedItem): boolean {
  return getEffectiveItemStatus(item) === 'COMPLETED';
}

/** 兜底：后端 EnrichedItem 未携带 signOffStatus 时，按 ownerName 与时间轴 SIGN 节点推断 */
function require_signoff_status(item: EnrichedItem): 'SIGNED' | 'NOT_SIGNED' | 'PARTIAL' {
  const signed = new Set<string>();
  for (const node of item.timeline || []) {
    if (node.type === 'SIGN' && typeof node.user === 'string' && node.user.trim()) signed.add(node.user.trim());
  }
  const owners: string[] = [];
  if (typeof item.ownerName === 'string' && item.ownerName.trim()) owners.push(item.ownerName.trim());
  if (Array.isArray(item.ownerNames)) {
    for (const n of item.ownerNames) if (typeof n === 'string' && n.trim()) owners.push(n.trim());
  }
  if (owners.length === 0) return 'NOT_SIGNED';
  const signedOwners = owners.filter(o => signed.has(o));
  if (signedOwners.length === 0) return 'NOT_SIGNED';
  if (signedOwners.length === owners.length) return 'SIGNED';
  return 'PARTIAL';
}

export type TabDisplayedSource = 'ui-card' | 'ui-proxy' | 'none';

export interface WorkbenchTabSpec {
  /** 标签键 */
  key: string;
  /** 标签展示名（规范口径名） */
  title: string;
  /** 规范统计口径说明 */
  description: string;
  /** 规范真实口径（事项级）：命中则该事项计入「真实数量」 */
  predicate: (item: EnrichedItem) => boolean;
  /** 工作台当前对应展示标签名（用于报告对照） */
  displayedTitle?: string;
  /**
   * 展示口径来源：
   *  - ui-card：工作台已有同名卡片，displayedPredicate 即其前端实现
   *  - ui-proxy：工作台无直接卡片，取最接近的现有卡片作为对照
   *  - none：工作台未实现该筛选标签，无法比对展示数
   */
  displayedSource: TabDisplayedSource;
  /** 工作台当前实际展示口径（事项级）：命中则该事项计入「展示数量」 */
  displayedPredicate?: (item: EnrichedItem) => boolean;
}

export const WORKBENCH_TAB_SPECS: WorkbenchTabSpec[] = [
  {
    key: 'pendingOpen',
    title: '待签收',
    description: '签收状态「未全部签收」（signOffStatus !== SIGNED）；排除关闭/办结状态（COMPLETED/ARCHIVED/DISABLED/NOT_SATISFIED）。事项维度，每件最多计 1',
    predicate: isPendingOpen,
    displayedTitle: '待签收',
    displayedSource: 'ui-card',
    displayedPredicate: isPendingOpen,
  },
  {
    key: 'overdue',
    title: '已超期',
    description: '有效状态为「已超时」(OVERDUE) 与「已延期」(DELAYED)；排除关闭/办结状态。事项维度',
    predicate: isOverdue,
    displayedTitle: '已超期',
    displayedSource: 'ui-card',
    displayedPredicate: isOverdue,
  },
  {
    key: 'noFeedback',
    title: '未反馈',
    description: '签收状态为 SIGNED 且不存在任何反馈记录（FEEDBACK/FOLLOWER_FEEDBACK 节点或 lastFeedbackDate）；排除关闭/办结状态。事项维度',
    predicate: isNoFeedback,
    displayedTitle: '未反馈',
    displayedSource: 'ui-card',
    displayedPredicate: isNoFeedback,
  },
  {
    key: 'incomplete',
    title: '未完成',
    description: '有效状态非「已办结」(COMPLETED)；排除已删除 DELETED。事项维度',
    predicate: isIncomplete,
    displayedTitle: '未完成',
    displayedSource: 'ui-card',
    displayedPredicate: isIncomplete,
  },
  {
    key: 'completed',
    title: '已完成',
    description: '有效状态为「已办结」(COMPLETED)。事项维度',
    predicate: isCompleted,
    displayedTitle: '已完成',
    displayedSource: 'ui-card',
    displayedPredicate: isCompleted,
  },
];

export interface ValidationItemRef {
  id: string;
  title: string;
  status: ItemStatus;
  effectiveStatus: ItemStatus;
  signOffStatus: 'SIGNED' | 'NOT_SIGNED' | 'PARTIAL';
}

export interface TabValidationResult {
  key: string;
  title: string;
  description: string;
  /** 规范口径真实数量（督办事项计数） */
  realCount: number;
  /** 工作台展示数量（督办事项计数；none 时为 null） */
  displayedCount: number | null;
  displayedTitle?: string;
  displayedSource: TabDisplayedSource;
  /** 是否一致（none 时为 null） */
  matched: boolean | null;
  /** 差异数 = 真实数 − 展示数（none 时为 null） */
  difference: number | null;
  /** 贡献数少于真实数的事项（规范应计、展示漏计） */
  onlyInReal: ValidationItemRef[];
  /** 贡献数多于真实数的事项（展示多计、规范不应计） */
  onlyInDisplayed: ValidationItemRef[];
}

export interface WorkbenchTabValidationReport {
  generatedAt: string;
  totalItems: number;
  activeItems: number;
  tabs: TabValidationResult[];
  summary: {
    matchedTabs: number;
    mismatchedTabs: number;
    notComparableTabs: number;
    totalMismatchItems: number;
  };
}

function toRef(item: EnrichedItem): ValidationItemRef {
  const s = getEffectiveItemStatus(item);
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    effectiveStatus: s,
    signOffStatus: (item.signOffStatus as ValidationItemRef['signOffStatus']) || 'NOT_SIGNED',
  };
}

/**
 * 校验工作台全部状态标签：比对「规范真实数」与「工作台展示数」。
 * @param items 经列表接口附加 timeline / signOffStatus 后的全量事项（超级管理员视角，无需数据权限过滤）
 *
 * 本模块以「管理员/领导/跟进人视角（事项维度）」为对账基准；责任人个人工作台的 person 模式不在范围内。
 */
export function validateWorkbenchTabs(items: EnrichedItem[]): WorkbenchTabValidationReport {
  // 工作台仅对「有效事项」计数（排除已删除），与前端 activeItems 口径一致
  const working = items.filter(item => item.status !== 'DELETED');

  const tabs: TabValidationResult[] = WORKBENCH_TAB_SPECS.map(spec => {
    if (spec.displayedSource === 'none' || !spec.displayedPredicate) {
      let realCount = 0;
      for (const item of working) {
        if (spec.predicate(item)) realCount += 1;
      }
      return {
        key: spec.key,
        title: spec.title,
        description: spec.description,
        realCount,
        displayedCount: null,
        displayedTitle: spec.displayedTitle,
        displayedSource: spec.displayedSource,
        matched: null,
        difference: null,
        onlyInReal: [],
        onlyInDisplayed: [],
      };
    }

    let realCount = 0;
    let displayedCount = 0;
    const onlyInReal: ValidationItemRef[] = [];
    const onlyInDisplayed: ValidationItemRef[] = [];

    for (const item of working) {
      const r = spec.predicate(item) ? 1 : 0;
      const d = spec.displayedPredicate!(item) ? 1 : 0;
      realCount += r;
      displayedCount += d;
      if (r !== d) {
        const ref = toRef(item);
        if (r > d) onlyInReal.push(ref);
        if (d > r) onlyInDisplayed.push(ref);
      }
    }

    const matched = realCount === displayedCount && onlyInReal.length === 0 && onlyInDisplayed.length === 0;

    return {
      key: spec.key,
      title: spec.title,
      description: spec.description,
      realCount,
      displayedCount,
      displayedTitle: spec.displayedTitle,
      displayedSource: spec.displayedSource,
      matched,
      difference: realCount - displayedCount,
      onlyInReal,
      onlyInDisplayed,
    };
  });

  const mismatched = tabs.filter(t => t.matched === false);
  const notComparable = tabs.filter(t => t.matched === null);

  return {
    generatedAt: new Date().toISOString(),
    totalItems: items.length,
    activeItems: working.length,
    tabs,
    summary: {
      matchedTabs: tabs.length - mismatched.length - notComparable.length,
      mismatchedTabs: mismatched.length,
      notComparableTabs: notComparable.length,
      totalMismatchItems: tabs.reduce((acc, t) => acc + t.onlyInReal.length + t.onlyInDisplayed.length, 0),
    },
  };
}

/** 生成人类可读的校验报告（控制台 / 日志友好） */
export function formatValidationReport(report: WorkbenchTabValidationReport): string {
  const lines: string[] = [];
  lines.push('================================================================');
  lines.push('  工作台状态筛选标签 · 展示数 vs 真实数 校验报告（事项维度 / 管理员·领导·跟进人视角）');
  lines.push('================================================================');
  lines.push(`生成时间 : ${report.generatedAt}`);
  lines.push(`事项总数 : ${report.totalItems}（有效 ${report.activeItems}）`);
  lines.push('');

  for (const t of report.tabs) {
    lines.push(`【${t.title}】${t.key}`);
    lines.push(`  口径 : ${t.description}`);
    if (t.displayedSource === 'none') {
      lines.push(`  展示 : 工作台未实现该筛选标签，无法比对展示数`);
      lines.push(`  真实 : ${t.realCount}`);
      lines.push(`  结论 : ⚠️ 不可比对（建议补充『${t.title}』汇总标签）`);
    } else {
      const statusText = t.matched ? '✅ 一致' : '❌ 不一致';
      const diffText = t.difference === null ? '' : `（差值 ${t.difference > 0 ? '+' : ''}${t.difference}）`;
      lines.push(`  展示 : ${t.displayedCount}（对照：${t.displayedTitle} / ${t.displayedSource}）`);
      lines.push(`  真实 : ${t.realCount}`);
      lines.push(`  结论 : ${statusText}${diffText}`);
      if (!t.matched) {
        if (t.onlyInReal.length) {
          lines.push(`        ▸ 规范应计更多、展示漏计（${t.onlyInReal.length} 条）:`);
          for (const r of t.onlyInReal.slice(0, 20)) {
            lines.push(`          - [${r.id}] ${r.title}（状态=${r.status}, 有效=${r.effectiveStatus}, 签收=${r.signOffStatus}）`);
          }
          if (t.onlyInReal.length > 20) lines.push(`          … 其余 ${t.onlyInReal.length - 20} 条略`);
        }
        if (t.onlyInDisplayed.length) {
          lines.push(`        ▸ 展示多计、规范不应计（${t.onlyInDisplayed.length} 条）:`);
          for (const r of t.onlyInDisplayed.slice(0, 20)) {
            lines.push(`          - [${r.id}] ${r.title}（状态=${r.status}, 有效=${r.effectiveStatus}, 签收=${r.signOffStatus}）`);
          }
          if (t.onlyInDisplayed.length > 20) lines.push(`          … 其余 ${t.onlyInDisplayed.length - 20} 条略`);
        }
      }
    }
    lines.push('');
  }

  const s = report.summary;
  lines.push('----------------------------------------------------------------');
  lines.push(`汇总：一致 ${s.matchedTabs} / 不一致 ${s.mismatchedTabs} / 不可比对 ${s.notComparableTabs}`);
  lines.push(`差异明细条目合计：${s.totalMismatchItems}`);
  lines.push('================================================================');
  return lines.join('\n');
}
