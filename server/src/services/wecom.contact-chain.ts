// 企业微信通讯录「官方推荐拉取链路」的低层接口封装与数据整理：
//   1. user/list_id（仅通讯录同步 secret 可调用）分页枚举全量 userid → 部门映射
//   2. user/get（自建应用 secret）逐人读取成员详情
//   3. auth/getuserdetail（oauth2 snsapi_privateinfo 授权后的 user_ticket）读取成员敏感信息
// 本模块不触碰数据库；HTTP 依赖通过 requester 注入，便于聚焦测试。
// 企微错误码统一经 translateWecomError 输出（常见码附带后台配置指引）。

import { translateWecomError } from './wecom.error-msg';

export type WecomRequester = (url: string, init?: RequestInit) => Promise<Response>;

const defaultRequester: WecomRequester = (url, init) => fetch(url, init);

const QYAPI_BASE = 'https://qyapi.weixin.qq.com/cgi-bin';

export interface WecomListIdEntry {
  userid: string;
  department: number;
}

/** 同步落库前的归一化成员结构（两条拉取链路共用） */
export interface WecomUserMember {
  userid: string;
  name: string | null;
  email: string | null;
  mobile: string | null;
  status: number | null;
  departments: number[];
  jobNumber: string | null;
}

async function requestWecomJson(
  requester: WecomRequester,
  url: string,
  errorLabel: string,
  init?: RequestInit,
): Promise<any> {
  const response = await requester(url, init);
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${errorLabel}失败: 响应不是有效的JSON对象`);
  }
  if (typeof data.errcode === 'number' && data.errcode !== 0) {
    throw new Error(translateWecomError(errorLabel, data.errcode, data.errmsg));
  }
  return data;
}

// user/list_id 单页上限 10000；取 1000 控制单次响应体积，翻页取全量。
const LIST_ID_PAGE_SIZE = 1000;
// 防御 next_cursor 异常导致的死循环：1000/页 × 500 页已远超常见企业规模。
const LIST_ID_MAX_PAGES = 500;

/** POST /cgi-bin/user/list_id：游标翻页拉取全量「成员-部门」关系（须使用通讯录同步 secret 的 token） */
export async function fetchWecomUserIdPages(
  contactSyncToken: string,
  requester: WecomRequester = defaultRequester,
): Promise<WecomListIdEntry[]> {
  const url = `${QYAPI_BASE}/user/list_id?access_token=${encodeURIComponent(contactSyncToken)}`;
  const entries: WecomListIdEntry[] = [];
  let cursor = '';

  for (let page = 0; page < LIST_ID_MAX_PAGES; page += 1) {
    const body: Record<string, unknown> = { limit: LIST_ID_PAGE_SIZE };
    if (cursor) body.cursor = cursor;
    const data = await requestWecomJson(requester, url, '获取企业微信成员ID列表', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const deptUser = Array.isArray(data.dept_user) ? data.dept_user : [];
    for (const row of deptUser) {
      if (row && typeof row.userid === 'string' && row.userid.length > 0 && Number.isFinite(row.department)) {
        entries.push({ userid: row.userid, department: Number(row.department) });
      }
    }

    cursor = typeof data.next_cursor === 'string' && data.next_cursor ? data.next_cursor : '';
    if (!cursor) return entries;
  }
  throw new Error('获取企业微信成员ID列表失败: 翻页次数超出上限，疑似 next_cursor 异常');
}

/** 多部门成员在 list_id 里会有多条记录，聚合为 userid → 去重部门列表 */
export function aggregateDepartmentsByUser(entries: WecomListIdEntry[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const { userid, department } of entries) {
    const list = map.get(userid);
    if (list) {
      if (!list.includes(department)) list.push(department);
    } else {
      map.set(userid, [department]);
    }
  }
  return map;
}

/** GET /cgi-bin/user/get：读取单个成员详情（使用自建应用 secret 的 token） */
export async function fetchWecomUserDetailRaw(
  appToken: string,
  userid: string,
  requester: WecomRequester = defaultRequester,
): Promise<any> {
  const url = `${QYAPI_BASE}/user/get?access_token=${encodeURIComponent(appToken)}&userid=${encodeURIComponent(userid)}`;
  return requestWecomJson(requester, url, `读取企业微信成员(${userid})详情`);
}

const JOB_NUMBER_ATTR_NAMES = new Set(['工号', 'job_number', 'jobnumber', 'job number']);

/**
 * 提取工号：user/get 的返回字段里没有 job_number（官方文档口径），
 * 兜底顺序为 detail.job_number（部分旧链路/未来开放）→ extattr 扩展属性中
 * 名称为「工号 / job_number」的文本值。取不到返回 null，工号关联逻辑自然跳过。
 */
export function extractJobNumber(detail: any): string | null {
  const direct = detail?.job_number;
  if (typeof direct === 'string' || typeof direct === 'number') {
    const value = String(direct).trim();
    if (value) return value;
  }
  const attrs = detail?.extattr?.attrs;
  if (!Array.isArray(attrs)) return null;
  for (const attr of attrs) {
    const name = typeof attr?.name === 'string' ? attr.name.trim().toLowerCase() : '';
    if (!JOB_NUMBER_ATTR_NAMES.has(name)) continue;
    const value = attr?.text?.value;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** 将 user/get 原始返回归一化为 WecomUserMember；detail 缺部门时回退 list_id 聚合结果 */
export function buildMemberFromUserGet(detail: any, fallbackDepartments: number[] = []): WecomUserMember {
  const rawDepartments = Array.isArray(detail?.department)
    && detail.department.every((dept: unknown) => Number.isFinite(dept))
    ? detail.department.map((dept: unknown) => Number(dept))
    : fallbackDepartments;
  return {
    userid: typeof detail?.userid === 'string' ? detail.userid : '',
    name: typeof detail?.name === 'string' && detail.name.trim() ? detail.name.trim() : null,
    email: typeof detail?.email === 'string' && detail.email.trim() ? detail.email.trim() : null,
    mobile: typeof detail?.mobile === 'string' && detail.mobile.trim() ? detail.mobile.trim() : null,
    status: Number.isFinite(detail?.status) ? Number(detail.status) : null,
    departments: rawDepartments,
    jobNumber: extractJobNumber(detail),
  };
}

export interface WecomSensitiveDetail {
  userid: string | null;
  mobile: string | null;
  email: string | null;
  bizMail: string | null;
}

/** POST /cgi-bin/auth/getuserdetail：凭 snsapi_privateinfo 授权返回的 user_ticket 读取成员敏感信息 */
export async function fetchWecomUserSensitiveDetail(
  appToken: string,
  userTicket: string,
  requester: WecomRequester = defaultRequester,
): Promise<WecomSensitiveDetail> {
  const url = `${QYAPI_BASE}/auth/getuserdetail?access_token=${encodeURIComponent(appToken)}`;
  const data = await requestWecomJson(requester, url, '获取企业微信成员敏感信息', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_ticket: userTicket }),
  });
  return {
    userid: typeof data.userid === 'string' && data.userid ? data.userid : null,
    mobile: typeof data.mobile === 'string' && data.mobile.trim() ? data.mobile.trim() : null,
    email: typeof data.email === 'string' && data.email.trim() ? data.email.trim() : null,
    bizMail: typeof data.biz_mail === 'string' && data.biz_mail.trim() ? data.biz_mail.trim() : null,
  };
}
