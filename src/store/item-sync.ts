import { SupervisionItem } from '../types';
import { getUniqueTimeline } from '../lib/item-format';

type RemoteSubTask = NonNullable<SupervisionItem['subTasks']>[number];
type RemoteSharedUser = NonNullable<SupervisionItem['sharedWith']>[number];
type RemoteAttachment = NonNullable<SupervisionItem['attachments']>[number];

type RemoteSupervisionItem = SupervisionItem & {
  createdAt?: string;
  updatedAt?: string;
};

type ItemListPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function unpackItemsListResponse(response: unknown): { items: any[]; pagination?: ItemListPagination } | null {
  if (Array.isArray(response)) return { items: response };
  if (!response || typeof response !== 'object') return null;
  const page = response as { data?: unknown; pagination?: unknown };
  if (!Array.isArray(page.data) || !page.pagination || typeof page.pagination !== 'object') return null;
  const pagination = page.pagination as Partial<ItemListPagination>;
  if (![pagination.page, pagination.pageSize, pagination.total, pagination.totalPages].every(Number.isFinite)) return null;
  return { items: page.data, pagination: pagination as ItemListPagination };
}

function parseJsonArray<T>(value: unknown): T[] | undefined {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : undefined;
  } catch {
    return undefined;
  }
}

/** 格式化时间轴时间戳：ISO 字符串 → YYYY-MM-DD HH:mm:ss */
function formatTimelineTimestamp(raw: unknown): string {
  if (!raw) return '';
  // 已经是格式化字符串（如 '2026-05-01 10:00'）直接返回
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    return raw;
  }
  try {
    const d = raw instanceof Date ? raw : new Date(raw as any);
    if (isNaN(d.getTime())) return String(raw);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return String(raw);
  }
}

export function normalizeRemoteItem(item: any): RemoteSupervisionItem {
  return {
    ...item,
    ownerIds: parseJsonArray<string>(item.ownerIds) || [],
    ownerNames: parseJsonArray<string>(item.ownerNames) || [],
    followerIds: parseJsonArray<string>(item.followerIds) || [],
    followerNames: parseJsonArray<string>(item.followerNames) || [],
    deptNames: parseJsonArray<string>(item.deptNames) || [],
    subTasks: parseJsonArray<RemoteSubTask>(item.subTasks) || [],
    sharedWith: parseJsonArray<RemoteSharedUser>(item.sharedWith) || [],
    attachments: parseJsonArray<RemoteAttachment>(item.attachments) || [],
  } as RemoteSupervisionItem;
}

function cloneItemForState(item: SupervisionItem): SupervisionItem {
  return {
    ...item,
    ownerIds: item.ownerIds ? [...item.ownerIds] : [],
    ownerNames: item.ownerNames ? [...item.ownerNames] : [],
    followerIds: item.followerIds ? [...item.followerIds] : [],
    followerNames: item.followerNames ? [...item.followerNames] : [],
    deptNames: item.deptNames ? [...item.deptNames] : [],
    timeline: getUniqueTimeline((item.timeline || []).map(node => ({
      ...node,
      attachments: node.attachments ? node.attachments.map(att => ({ ...att })) : undefined,
    }))),
    subTasks: item.subTasks ? item.subTasks.map(subTask => ({ ...subTask })) : [],
    sharedWith: item.sharedWith ? item.sharedWith.map(sharedUser => ({ ...sharedUser })) : [],
    attachments: item.attachments ? item.attachments.map(attachment => ({ ...attachment })) : [],
  };
}

export function resolveSyncedItems(remoteItems: any[] | null, localItems: SupervisionItem[], fallbackItems: SupervisionItem[]): SupervisionItem[] {
  if (!Array.isArray(remoteItems)) {
    const sourceItems = localItems.length > 0 ? localItems : fallbackItems;
    return sourceItems.map(cloneItemForState);
  }

  if (remoteItems.length === 0) return [];

  const localTimelineMap = new Map<string, any[]>();
  localItems.forEach(item => {
    if (item.timeline && item.timeline.length > 0) {
      localTimelineMap.set(item.id, item.timeline);
    }
  });

  return remoteItems.map(item => {
    const normalizedItem = normalizeRemoteItem(item);
    const localTimeline = localTimelineMap.get(normalizedItem.id) || [];
    const backendTimeline = Array.isArray(normalizedItem.timeline)
      ? normalizedItem.timeline.map((n: any) => ({
          ...n,
          timestamp: formatTimelineTimestamp(n.timestamp),
        }))
      : [];

    // 合并 timeline：以后端为基础，追加本地独有的条目（按 id 去重）
    const backendIds = new Set(backendTimeline.map((n: any) => n.id));
    const mergedTimeline = getUniqueTimeline([
      ...backendTimeline,
      ...localTimeline.filter((n: any) => !backendIds.has(n.id)),
    ]);

    return {
      ...normalizedItem,
      meetingName: normalizedItem.meetingName || normalizedItem.meetingSource || '',
      raiseDate: normalizedItem.raiseDate || (normalizedItem.createdAt ? new Date(String(normalizedItem.createdAt)).toISOString().split('T')[0] : ''),
      meetingSource: normalizedItem.meetingSource || normalizedItem.meetingName || '',
      timeline: mergedTimeline,
    };
  });
}
