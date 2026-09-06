export type RemainingDaysKind = 'none' | 'overdue' | 'left';

export interface RemainingDaysResult {
  /** none=未设日期；overdue=已超期；left=剩余/当天到期 */
  kind: RemainingDaysKind;
  /** overdue 表示已超期天数；left 表示含今天在内的剩余天数（到期当天=1） */
  days: number;
}

interface RemainingDaysInput {
  deadline?: string | null;
  requiredCompletionDate?: string | null;
  status?: string | null;
  now?: Date;
}

/** 兼容 `2026-08-28`、`2026/08/28` 及带时间的写法，按本地时区取当天 0 点，避免 UTC 解析漂移。 */
function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * 移动端剩余天数口径（列表卡片与详情页共用）：
 * - 日期基准优先取「要求完成日期」（跟进人统一口径），无则回退 deadline；
 * - 已批准延期（DELAYED）的事项以延期后的 deadline 为准，避免拿旧要求日期误报超期；
 * - 到期当天按「剩 1 天」展示（含当天）；
 * - 已过期为「超期 N 天」；OVERDUE 状态即使日期口径未过也至少展示超期 1 天。
 */
export function computeRemainingDays(input: RemainingDaysInput): RemainingDaysResult {
  const candidates = input.status === 'DELAYED'
    ? [input.deadline, input.requiredCompletionDate]
    : [input.requiredCompletionDate, input.deadline];
  const base = candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (!base) return { kind: 'none', days: 0 };
  const due = parseDateOnly(base);
  if (!due) return { kind: 'none', days: 0 };

  const today = startOfDay(input.now || new Date());
  const diffDays = Math.round((startOfDay(due).getTime() - today.getTime()) / 86400000);

  if (diffDays < 0 || input.status === 'OVERDUE') {
    return { kind: 'overdue', days: Math.max(1, -diffDays) };
  }
  return { kind: 'left', days: diffDays + 1 };
}
