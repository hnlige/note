import type { OperationLog } from '../types';

const BASE_URL = '/api';
export const AUTH_TOKEN_KEY = 'duban-auth-token';

export type ItemPageAuth =
  | 'MENU_ITEMS'
  | 'MENU_MY_ITEMS'
  | 'MENU_WORKBENCH'
  | 'MENU_AUDIT'
  | 'MENU_RECYCLE_BIN'
  | 'MENU_MONITORING'
  | 'MENU_MESSAGES';

export function hasAuthToken(storage?: Pick<Storage, 'getItem'> | null): boolean {
  try {
    const authStorage = storage ?? (typeof window !== 'undefined' ? localStorage : null);
    return Boolean(authStorage?.getItem(AUTH_TOKEN_KEY));
  } catch {
    return false;
  }
}

/**
 * 从 zustand store 获取当前用户认证信息
 */
function getAuthHeaders(): Record<string, string> {
  try {
    const headers: Record<string, string> = {};
    const token = hasAuthToken() && typeof window !== 'undefined' ? localStorage.getItem(AUTH_TOKEN_KEY) : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  } catch {
    return {};
  }
}

const IN_PROD = Boolean(import.meta.env?.PROD);
const AUTH_ENTRY_URLS = new Set(['/auth/login', '/wecom/login']);
const RENEWED_AUTH_TOKEN_HEADER = 'X-Duban-Auth-Token';

/** token 失效（过期/签名不符等）：清掉死 token 并跳登录页，避免卡在"看起来已登录却做不了任何操作"的状态 */
function redirectToLoginOnExpiry(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // storage may be unavailable in private mode; navigation below still recovers the session.
  }
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.assign('/login?expired=1');
  }
}

function isAuthEntryUrl(url: string): boolean {
  return AUTH_ENTRY_URLS.has(url);
}

function persistRenewedAuthToken(res: Response): void {
  const token = res.headers.get(RENEWED_AUTH_TOKEN_HEADER);
  if (!token || typeof window === 'undefined') return;
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // Best effort: the current request already succeeded, but future requests may need a re-login.
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  // 注意：headers 必须放在 ...options 之后合并，否则 options.headers（如 X-Page-Auth）
  // 会整体覆盖掉含 Authorization 的 headers，导致带 pageAuth 的写请求（发起/更新/删除/批量）丢 token → 401。
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...options?.headers },
  });
  persistRenewedAuthToken(res);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const status = res.status;
    // 401=鉴权失败（token 过期/失效）：清掉死 token 并跳登录，而不是只弹"请先登录"让用户在已登录态下卡死
    if (IN_PROD && status === 401 && !isAuthEntryUrl(url)) {
      err.error = '登录已过期，请重新登录';
      redirectToLoginOnExpiry();
    }
    const requestError = new Error(err.error || `请求失败 (${status})`) as Error & { status?: number };
    requestError.status = status;
    throw requestError;
  }
  return res.json();
}

async function uploadBinary<T>(url: string, file: File, pageAuth?: ItemPageAuth): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    method: 'POST',
    body: file,
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/octet-stream',
      'X-Duban-File-Name': encodeURIComponent(file.name),
      'X-Duban-File-Type': file.type || 'application/octet-stream',
      ...(pageAuth ? { 'X-Page-Auth': pageAuth } : {}),
    },
  });
  persistRenewedAuthToken(res);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(err.error || `附件上传失败 (${res.status})`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

function withPageAuth(pageAuth?: ItemPageAuth): Pick<RequestInit, 'headers'> {
  return pageAuth ? { headers: { 'X-Page-Auth': pageAuth } } : {};
}

export function compactItemUpdatePayload(data: any): any {
  if (!data || typeof data !== 'object' || !Array.isArray(data.timeline) || data.timeline.length === 0) return data;
  return { ...data, timeline: [data.timeline[data.timeline.length - 1]] };
}

// ─── Auth ───
export const api = {
  auth: {
    login: (username: string, password: string) =>
      request<{ id: string; username: string; name: string; role: string; roleId?: string; roleIds?: string[]; deptId?: string; orgId?: string; adminOrgIds?: string[]; token: string }>(
        '/auth/login',
        { method: 'POST', body: JSON.stringify({ username, password }) }
      ),
    changePassword: (oldPassword: string, newPassword: string) =>
      request<{ success: boolean }>(
        '/auth/change-password',
        { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) }
      ),
  },

  // ─── Items ───
  items: {
    list: (page = 1, pageSize = 200, pageAuth?: ItemPageAuth) => request<{ data: any[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>(
      `/items?page=${page}&pageSize=${pageSize}`,
      withPageAuth(pageAuth),
    ),
    getById: (id: string) => request<any>(`/items/${id}`),
    create: (data: any, pageAuth?: ItemPageAuth) =>
      request<{ id: string }>('/items', { method: 'POST', body: JSON.stringify(data), ...withPageAuth(pageAuth) }),
    batchCreate: (items: any[], pageAuth?: ItemPageAuth) =>
      request<{ total: number; successCount: number; failCount: number; results: { row: number; id?: string; serialNo: string; success: boolean; error?: string }[] }>(
        '/items/batch',
        { method: 'POST', body: JSON.stringify({ items }), ...withPageAuth(pageAuth) }
      ),
    update: (id: string, data: any, pageAuth?: ItemPageAuth) =>
      request(`/items/${id}`, { method: 'PUT', body: JSON.stringify(compactItemUpdatePayload(data)), ...withPageAuth(pageAuth) }),
    updateStatus: (id: string, status: string, pageAuth?: ItemPageAuth) =>
      request(`/items/${id}`, { method: 'PUT', body: JSON.stringify({ status }), ...withPageAuth(pageAuth) }),
    delete: (id: string, pageAuth?: ItemPageAuth) =>
      request(`/items/${id}`, { method: 'DELETE', ...withPageAuth(pageAuth) }),
  },

  attachments: {
    upload: (itemId: string, file: File, pageAuth?: ItemPageAuth) =>
      uploadBinary<{ id: string; name: string; url: string; storageKey: string; size: string; type: string; uploadedAt: string }>(
        `/attachments/items/${encodeURIComponent(itemId)}`,
        file,
        pageAuth,
      ),
  },

  // ─── Messages ───
  messages: {
    listPage: (page = 1, pageSize = 100) => request<{ data: any[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>(`/messages?page=${page}&pageSize=${pageSize}`),
    list: async () => (await api.messages.listPage()).data,
    markRead: (id: string) =>
      request(`/messages/${id}/read`, { method: 'PUT' }),
    create: (data: any) =>
      request('/messages', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request(`/messages/${id}`, { method: 'DELETE' }),
    deleteRead: (type?: string) =>
      request(`/messages?type=${encodeURIComponent(type || 'READ')}`, { method: 'DELETE' }),
  },
  // ─── Activities ───
  activities: {
    listPage: (page = 1, pageSize = 100) => request<{ data: any[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>(`/activities?page=${page}&pageSize=${pageSize}`),
    list: async () => (await api.activities.listPage()).data,
    create: (data: any) =>
      request('/activities', { method: 'POST', body: JSON.stringify(data) }),
  },
  // ─── Light Records ───
  lightRecords: {
    list: () => request<any[]>('/light-records'),
    create: (data: any) =>
      request('/light-records', { method: 'POST', body: JSON.stringify(data) }),
    clearByItemId: (itemId: string) =>
      request(`/light-records/item/${itemId}`, { method: 'DELETE' }),
  },

  // ─── Urges ───
  urges: {
    list: () => request<any[]>('/urge'),
    create: (data: any) =>
      request('/urge', { method: 'POST', body: JSON.stringify(data) }),
    batch: (data: any) =>
      request('/urge/batch', { method: 'POST', body: JSON.stringify(data) }),
    counts: (itemIds: string[]) =>
      request<{ byTarget: Record<string, number>; byItem: Record<string, number> }>(
        `/urge/counts?itemIds=${encodeURIComponent(itemIds.join(','))}`,
      ),
    stats: (params: Record<string, string | number | undefined> = {}) => {
      const qs = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');
      return request<any>(`/urge/stats${qs ? `?${qs}` : ''}`);
    },
    history: (params: Record<string, string | number | undefined> = {}) => {
      const qs = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');
      return request<{ rows: any[]; total: number; page: number; pageSize: number }>(
        `/urge/history${qs ? `?${qs}` : ''}`,
      );
    },
    dashboard: (params: Record<string, string | number | undefined> = {}) => {
      const qs = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');
      return request<any>(`/urge/dashboard${qs ? `?${qs}` : ''}`);
    },
    reply: (id: string, responseContent: string) =>
      request(`/urge/${id}/reply`, { method: 'PUT', body: JSON.stringify({ responseContent }) }),
  },

  // ─── Departments ───
  departments: {
    tree: () => request<any[]>('/departments'),
    flatList: () => request<any[]>('/departments/flat'),
    create: (id: string, name: string, parentId: string, type?: string) =>
      request('/departments', { method: 'POST', body: JSON.stringify({ id, name, parentId, type: type || 'DEPARTMENT' }) }),
    update: (id: string, name: string) =>
      request(`/departments/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
    delete: (id: string) =>
      request(`/departments/${id}`, { method: 'DELETE' }),
  },

  // ─── Users ───
  users: {
    list: () => request<any[]>('/users'),
    getPreferences: () => request<{ site?: boolean; email?: boolean; sms?: boolean }>('/users/me/preferences'),
    updatePreferences: (data: { site: boolean; email: boolean; sms: boolean }) =>
      request('/users/me/preferences', { method: 'PUT', body: JSON.stringify(data) }),
    create: (data: any) =>
      request<{ id: string }>('/users', { method: 'POST', body: JSON.stringify(data) }),
    batchCreate: (deptId: string, users: any[]) =>
      request('/users/batch', { method: 'POST', body: JSON.stringify({ deptId, users }) }),
    update: (id: string, data: any) =>
      request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request(`/users/${id}`, { method: 'DELETE' }),
  },

  // ─── Roles ───
  roles: {
    list: () => request<any[]>('/roles'),
    create: (data: any) =>
      request('/roles', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) =>
      request(`/roles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request(`/roles/${id}`, { method: 'DELETE' }),
  },

  // ─── Templates ───
  templates: {
    list: () => request<any[]>('/templates'),
    create: (data: any) =>
      request('/templates', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) =>
      request(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request(`/templates/${id}`, { method: 'DELETE' }),
  },

  // ─── Dictionaries ───
  dictionaries: {
    list: () => request<any[]>('/dictionaries'),
    create: (data: any) =>
      request('/dictionaries', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) =>
      request(`/dictionaries/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request(`/dictionaries/${id}`, { method: 'DELETE' }),
  },

  // ─── Audit Records ───
  audit: {
    listPage: (page = 1, pageSize = 100) => request<{ data: any[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>(`/audit?page=${page}&pageSize=${pageSize}`),
    list: async () => (await api.audit.listPage()).data,
    create: (data: any) =>
      request('/audit', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) =>
      request(`/audit/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },

  // ─── Async Tasks ───
  asyncTasks: {
    list: () => request<any[]>('/async-tasks'),
    create: (data: any) =>
      request('/async-tasks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) =>
      request(`/async-tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },

  // ─── Global Rules ───
  globalRules: {
    get: () => request<any>('/global-rules'),
    update: (data: any) =>
      request('/global-rules', { method: 'PUT', body: JSON.stringify(data) }),
    testWecom: (data: any) =>
      request<{ ok: boolean; message: string }>('/global-rules/wecom/test', { method: 'POST', body: JSON.stringify(data) }),
    verifyWecom: (data: any) =>
      request<{ ok: boolean; message: string }>('/global-rules/wecom/verify', { method: 'POST', body: JSON.stringify(data) }),
  },

  // ─── Operation Log ───
  logs: {
    listPage: (page = 1, pageSize = 200) => request<{ data: any[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>(`/logs?page=${page}&pageSize=${pageSize}`),
    list: async (limit?: number) => (await api.logs.listPage(1, limit || 200)).data,
    create: (data: Pick<OperationLog, 'action' | 'module'> & { detail?: string }) =>
      request<{ success: true; log: OperationLog }>('/logs', { method: 'POST', body: JSON.stringify(data) }),
  },

  // ─── Wecom Integration ───
  wecom: {
    login: (code: string) =>
      request<any>('/wecom/login', { method: 'POST', body: JSON.stringify({ code }) }),
    sync: () =>
      request<{ ok: boolean; message: string; taskId: string }>('/wecom/sync', { method: 'POST' }),
    getConfig: () =>
      request<{ wecomCorpId: string; wecomAgentId: string }>('/wecom/config'),
  },

  // ─── 员工督办转交（仅超级管理员）───
  reassign: {
    preview: (data: { fromUserId: string; toUserId: string; scope: 'OWNER' | 'FOLLOWER' | 'ALL' }) =>
      request<{ count: number; conflicts: string[] }>('/admin/reassign-supervision/preview', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    execute: (data: {
      fromUserId: string;
      toUserId: string;
      scope: 'OWNER' | 'FOLLOWER' | 'ALL';
      disableSource?: boolean;
    }) =>
      request<{
        success: true;
        reassigned: number;
        ownerReassignCount: number;
        followerReassignCount: number;
        itemIds: string[];
        disabledSource: boolean;
      }>('/admin/reassign-supervision', { method: 'POST', body: JSON.stringify(data) }),
  },
};
