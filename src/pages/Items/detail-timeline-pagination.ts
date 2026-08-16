import { DEFAULT_PAGE_SIZE_OPTIONS, paginateItems } from '../../components/Common/pagination';
import { getUniqueTimeline } from '../../lib/item-format';
import type { TimelineNode } from '../../types';

export const TIMELINE_PAGE_SIZE_OPTIONS = DEFAULT_PAGE_SIZE_OPTIONS;

function parseTimestamp(value?: string): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

// 详情页执行时间轴：去重 -> 按时间倒序（新在前）-> 按选中责任人过滤。
// 提取为纯函数便于测试；分页仍复用通用 paginateItems。
export function prepareTimelineNodes(
  timeline: TimelineNode[] | undefined,
  selectedOwner: string | null,
): TimelineNode[] {
  const nodes = getUniqueTimeline(timeline ?? [])
    .slice()
    .sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));
  if (!selectedOwner) return nodes;
  const ownerMarker = `「${selectedOwner}」`;
  return nodes.filter(node => node.user === selectedOwner || node.content?.includes(ownerMarker));
}

export const paginateTimelineNodes = paginateItems;
