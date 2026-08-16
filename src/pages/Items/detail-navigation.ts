import type { ItemPageAuth } from '../../lib/api';

const DETAIL_ORIGIN_PAGE_AUTH: Readonly<Record<string, ItemPageAuth>> = {
  '/items': 'MENU_ITEMS',
  '/my-items': 'MENU_MY_ITEMS',
  '/workbench': 'MENU_WORKBENCH',
  '/items/audit': 'MENU_AUDIT',
  '/items/recycle-bin': 'MENU_RECYCLE_BIN',
};

function getDetailOriginPath(state?: unknown): string {
  const from = typeof state === 'object' && state !== null && 'from' in state && typeof (state as { from?: unknown }).from === 'string'
    ? (state as { from: string }).from.trim()
    : '';
  if (!from.startsWith('/') || from.startsWith('//')) return '';

  const pathname = from.split(/[?#]/, 1)[0];
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function getDetailBackNavigation(state?: unknown): { path: string; label: string } {
  const from = typeof state === 'object' && state !== null && 'from' in state && typeof (state as { from?: unknown }).from === 'string'
    ? (state as { from: string }).from.trim()
    : '';
  const label = typeof state === 'object' && state !== null && 'label' in state && typeof (state as { label?: unknown }).label === 'string'
    ? (state as { label: string }).label.trim()
    : '';

  if (!from) return { path: '/items', label: '返回列表' };
  return { path: from, label: label || '返回列表' };
}

export function getDetailPageAuth(state?: unknown): ItemPageAuth {
  return DETAIL_ORIGIN_PAGE_AUTH[getDetailOriginPath(state)] || 'MENU_ITEMS';
}

/** 仅接受导航状态携带的合法消息 ID，避免从 URL 或任意对象误触发已读。 */
export function getMessageIdFromDetailState(state?: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('messageId' in state)) return null;
  const messageId = (state as { messageId?: unknown }).messageId;
  return typeof messageId === 'string' && messageId.trim() ? messageId : null;
}

const VALID_DETAIL_PAGE_AUTHS = new Set<string>(Object.values(DETAIL_ORIGIN_PAGE_AUTH));

/**
 * 从 URL 查询参数还原详情页来源权限，校验白名单后返回；
 * 非法/伪造/未知来源一律回退到 MENU_ITEMS，避免越权访问其他模块数据。
 */
export function getDetailPageAuthFromQuery(value: unknown): ItemPageAuth {
  if (typeof value === 'string' && VALID_DETAIL_PAGE_AUTHS.has(value)) {
    return value as ItemPageAuth;
  }
  return 'MENU_ITEMS';
}

/** 构造携带归一化来源（origin=pageAuth）的详情页 URL，刷新后可据此还原页面上下文。 */
export function buildItemDetailUrl(id: string, pageAuth: ItemPageAuth, query?: Record<string, string>): string {
  const params = new URLSearchParams();
  params.set('origin', pageAuth);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (key && value != null) params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return `/items/${id}${qs ? `?${qs}` : ''}`;
}
