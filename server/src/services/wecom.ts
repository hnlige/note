import { getDb } from '../db';
import { hashPassword } from '../routes/auth.password';
import { v4 as uuidv4 } from 'uuid';
import { resolveSyncTarget } from './wecom.sync-target';
import { translateWecomError } from './wecom.error-msg';
import {
  aggregateDepartmentsByUser,
  buildMemberFromUserGet,
  fetchWecomUserDetailRaw,
  fetchWecomUserIdPages,
  fetchWecomUserSensitiveDetail,
  type WecomUserMember,
} from './wecom.contact-chain';

const QYAPI_BASE = 'https://qyapi.weixin.qq.com/cgi-bin';

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

let cachedContactSyncToken: string | null = null;
let contactSyncTokenExpiresAt = 0;

async function loadWecomConfig() {
  const db = await getDb();
  const { globalRules: rulesTable } = await import('../db/schema');
  const [config] = await db.select().from(rulesTable).limit(1);
  return config ?? null;
}

async function fetchWecomAccessToken(corpId: string, secret: string, errorLabel: string): Promise<{ token: string; expiresIn: number }> {
  const url = `${QYAPI_BASE}/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
  const response = await fetch(url);
  const data = await response.json() as any;

  if (data.errcode && data.errcode !== 0) {
    throw new Error(translateWecomError(errorLabel, data.errcode, data.errmsg));
  }
  if (!data.access_token) {
    throw new Error(`${errorLabel}失败: 响应中缺少 access_token`);
  }
  return { token: data.access_token, expiresIn: Number(data.expires_in) || 7200 };
}

/** 自建应用 secret 的 access_token（消息发送、user/get、oauth 身份换取等） */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && now < tokenExpiresAt) {
    return cachedAccessToken;
  }

  const config = await loadWecomConfig();
  if (!config || !config.wecomCorpId || !config.wecomCorpSecret) {
    throw new Error('未在系统全局配置中完整设置企业微信 CorpID 或 Secret');
  }

  const { token, expiresIn } = await fetchWecomAccessToken(config.wecomCorpId, config.wecomCorpSecret, '获取企业微信 access_token ');
  cachedAccessToken = token;
  // 提前 5 分钟失效
  tokenExpiresAt = now + (expiresIn - 300) * 1000;
  return cachedAccessToken!;
}

/** 通讯录同步助手 secret 的 access_token（仅 user/list_id 枚举成员ID使用） */
export async function getContactSyncAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedContactSyncToken && now < contactSyncTokenExpiresAt) {
    return cachedContactSyncToken;
  }

  const config = await loadWecomConfig();
  if (!config || !config.wecomCorpId || !config.wecomContactSecret) {
    throw new Error('未在系统全局配置中设置企业微信「通讯录同步」Secret（企业微信管理后台 → 管理工具 → 通讯录同步）');
  }

  const { token, expiresIn } = await fetchWecomAccessToken(config.wecomCorpId, config.wecomContactSecret, '获取企业微信通讯录同步 access_token ');
  cachedContactSyncToken = token;
  contactSyncTokenExpiresAt = now + (expiresIn - 300) * 1000;
  return cachedContactSyncToken!;
}

export interface WecomCodeIdentity {
  userid: string;
  /** scope=snsapi_privateinfo 授权时返回，可用于 auth/getuserdetail 换取手机号/邮箱等敏感信息 */
  userTicket: string | null;
}

export async function getWecomUserIdByCode(code: string): Promise<WecomCodeIdentity> {
  const token = await getAccessToken();
  const url = `${QYAPI_BASE}/auth/getuserinfo?access_token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`;
  const response = await fetch(url);
  const data = await response.json() as any;

  if (data.errcode && data.errcode !== 0) {
    throw new Error(translateWecomError('换取企业微信 UserID', data.errcode, data.errmsg));
  }

  const userid = data.userid || data.UserId;
  if (!userid) {
    throw new Error('未从企业微信返回的身份数据中解析到有效的 UserID');
  }

  return {
    userid,
    userTicket: typeof data.user_ticket === 'string' && data.user_ticket ? data.user_ticket : null,
  };
}

/** 凭 snsapi_privateinfo 授权的 user_ticket 读取成员敏感信息（手机号/邮箱等） */
export async function getWecomSensitiveDetailByTicket(userTicket: string) {
  const token = await getAccessToken();
  return fetchWecomUserSensitiveDetail(token, userTicket);
}

// ─── 通讯录同步（两条链路共用） ───

export type WecomSyncMode = 'legacy' | 'list_id';

export interface WecomSyncResult {
  mode: WecomSyncMode;
  deptCount: number;
  userCount: number;
  linkedByJobNumber: number;
  linkedByUsername: number;
}

export function normalizeWecomSyncMode(value: unknown): WecomSyncMode {
  return value === 'list_id' ? 'list_id' : 'legacy';
}

async function syncDepartmentsFromWecom(token: string): Promise<{ wecomDepts: any[]; wecomToLocalIdMap: Map<string, string> }> {
  const db = await getDb();
  const { eq } = await import('drizzle-orm');
  const { departments: deptTable } = await import('../db/schema');

  // 1. 获取企业微信侧的所有部门
  const deptUrl = `${QYAPI_BASE}/department/list?access_token=${encodeURIComponent(token)}`;
  const deptRes = await fetch(deptUrl);
  const deptData = await deptRes.json() as any;

  if (deptData.errcode && deptData.errcode !== 0) {
    throw new Error(translateWecomError('获取企业微信部门树', deptData.errcode, deptData.errmsg));
  }

  const wecomDepts = deptData.department || [];

  // 2. 双向同步部门
  // 获取数据库现有部门，建立 wecom_dept_id 到本地部门的映射
  const localDepts = await db.select().from(deptTable);
  const deptMap = new Map<string, any>(); // wecom_dept_id -> local dept
  for (const d of localDepts) {
    const dWecomId = (d as any).wecomDeptId;
    if (dWecomId) {
      deptMap.set(dWecomId, d);
    }
  }

  // 第一步：确保所有部门记录存在（但不急于设置 parent_id）
  for (const wd of wecomDepts) {
    const wecomIdStr = String(wd.id);
    const existing = deptMap.get(wecomIdStr);

    if (existing) {
      // 更新部门名称和排序
      await db.update(deptTable)
        .set({
          name: wd.name,
          sortOrder: wd.order || 0
        } as any)
        .where(eq(deptTable.id, existing.id));
    } else {
      // 插入新部门
      const newId = uuidv4();
      await db.insert(deptTable).values({
        id: newId,
        name: wd.name,
        sortOrder: wd.order || 0,
        type: 'DEPARTMENT',
        wecomDeptId: wecomIdStr
      } as any);
      // 放入 Map 以供后续 parentId 解析
      deptMap.set(wecomIdStr, { id: newId, wecomDeptId: wecomIdStr });
    }
  }

  // 刷新拉取最新所有部门，用于建立完整的 id 映射
  const refreshedDepts = await db.select().from(deptTable);
  const wecomToLocalIdMap = new Map<string, string>();
  for (const d of refreshedDepts) {
    const dWecomId = (d as any).wecomDeptId;
    if (dWecomId) {
      wecomToLocalIdMap.set(dWecomId, d.id);
    }
  }

  // 第二步：更新所有部门的 parent_id 映射
  for (const wd of wecomDepts) {
    const wecomIdStr = String(wd.id);
    const localId = wecomToLocalIdMap.get(wecomIdStr);
    const wecomParentIdStr = String(wd.parentid);

    if (localId && wd.parentid && wd.parentid !== 0) {
      const localParentId = wecomToLocalIdMap.get(wecomParentIdStr);
      if (localParentId) {
        await db.update(deptTable)
          .set({ parentId: localParentId } as any)
          .where(eq(deptTable.id, localId));
      }
    }
  }

  return { wecomDepts, wecomToLocalIdMap };
}

/**
 * 将企微成员落到本地用户表：
 *   1) wecom_user_id 命中 → 关联更新；2) 工号唯一命中未关联账号 → 回填关联；
 *   3) userid 恰与未关联登录账号同名 → 回填关联（与移动端免登的 username 兜底口径一致）；
 *   4) 都未命中 → 新建。
 * clearMissingContactFields：企微未返回手机/邮箱时是否清空本地值。
 * legacy 链路（user/list 拿得到敏感字段）保持清空、以企微为准；
 * list_id 链路（user/get 对新应用降级不返回敏感字段）不清空，避免误抹本地资料。
 */
async function applyWecomMembersToUsers(
  members: WecomUserMember[],
  wecomToLocalIdMap: Map<string, string>,
  options: { clearMissingContactFields: boolean },
): Promise<{ userCount: number; linkedByJobNumber: number; linkedByUsername: number }> {
  const db = await getDb();
  const { eq } = await import('drizzle-orm');
  const { users: usersTable } = await import('../db/schema');

  // 获取数据库现有用户：按 wecom_user_id 与登录账号（仅未关联账号，用于工号/userid 匹配）建立索引
  const localUsers = await db.select().from(usersTable);
  const userMap = new Map<string, any>();
  const usernameMap = new Map<string, any>();
  for (const u of localUsers) {
    const uWecomId = (u as any).wecomUserId;
    if (uWecomId) {
      userMap.set(uWecomId, u);
      continue;
    }
    const uUsername = typeof (u as any).username === 'string' ? (u as any).username.trim() : '';
    if (uUsername) usernameMap.set(uUsername, u);
  }

  const linkAccount = async (userId: string, wecomUserId: string) => {
    await db.update(usersTable)
      .set({ wecomUserId } as any)
      .where(eq(usersTable.id, userId));
  };

  let linkedByJobNumber = 0;
  let linkedByUsername = 0;

  for (const member of members) {
    if (!member.userid) continue;
    const decision = resolveSyncTarget(
      { userid: member.userid, job_number: member.jobNumber ?? undefined },
      userMap,
      usernameMap,
    );

    // 解析用户的本地部门 ID（取其企业微信关联的首个部门进行映射）
    let localDeptId: string | null = null;
    if (member.departments.length > 0) {
      localDeptId = wecomToLocalIdMap.get(String(member.departments[0])) || null;
    }

    if (decision.via === 'wecom_id') {
      // 已关联账号：姓名/邮箱/手机/部门/状态以企微为准（既有行为）
      const patch: Record<string, unknown> = {
        deptId: localDeptId,
      };
      if (member.name != null) patch.name = member.name;
      if (member.status != null) patch.status = member.status === 1 ? 'ACTIVE' : 'INACTIVE';
      if (member.email != null || options.clearMissingContactFields) patch.email = member.email;
      if (member.mobile != null || options.clearMissingContactFields) patch.phone = member.mobile;
      await db.update(usersTable).set(patch as any).where(eq(usersTable.id, decision.targetId!));
      continue;
    }

    if (decision.via === 'job_number') {
      // 工号唯一命中未关联存量账号：仅回填 wecom_user_id 建立关联，不改动既有资料
      await linkAccount(decision.targetId!, member.userid);
      linkedByJobNumber += 1;
      // 该登录账号已被占用，防止其他同工号成员重复绑到同一账号
      usernameMap.delete(String(member.jobNumber ?? '').trim());
      continue;
    }

    const usernameHit = usernameMap.get(member.userid);
    if (usernameHit) {
      // userid 恰与未关联登录账号同名：回填关联（口径同移动端免登的 username 兜底匹配）
      await linkAccount(usernameHit.id, member.userid);
      linkedByUsername += 1;
      usernameMap.delete(member.userid);
      continue;
    }

    // 不存在则创建新用户
    const newId = uuidv4();
    const randomPassword = uuidv4().slice(0, 16);
    const encryptedPassword = await hashPassword(randomPassword);

    await db.insert(usersTable).values({
      id: newId,
      username: member.userid,
      password: encryptedPassword,
      name: member.name || member.userid,
      role: 'OWNER', // 默认分配承办人/责任人角色
      email: member.email || null,
      phone: member.mobile || null,
      deptId: localDeptId,
      wecomUserId: member.userid,
      status: member.status == null || member.status === 1 ? 'ACTIVE' : 'INACTIVE'
    } as any);
  }

  return { userCount: members.length, linkedByJobNumber, linkedByUsername };
}

/** 兼容链路：department/list + user/list(含敏感字段) 一次拉齐（依赖 2022-06 前老应用的 secret 口径） */
async function syncContactsLegacy(): Promise<WecomSyncResult> {
  const token = await getAccessToken();
  const { wecomDepts, wecomToLocalIdMap } = await syncDepartmentsFromWecom(token);

  const userUrl = `${QYAPI_BASE}/user/list?access_token=${encodeURIComponent(token)}&department_id=1&fetch_child=1`;
  const userRes = await fetch(userUrl);
  const userData = await userRes.json() as any;

  if (userData.errcode && userData.errcode !== 0) {
    throw new Error(translateWecomError('获取企业微信成员详情', userData.errcode, userData.errmsg));
  }

  const wecomUsers = userData.userlist || [];
  // user/list 行结构（userid/name/email/mobile/status/department/job_number）与 user/get 兼容，
  // 复用同一归一化器，保证两条链路落库口径一致。
  const members = wecomUsers.map((wu: any) => buildMemberFromUserGet(wu));
  const applyResult = await applyWecomMembersToUsers(members, wecomToLocalIdMap, { clearMissingContactFields: true });

  return { mode: 'legacy', deptCount: wecomDepts.length, ...applyResult };
}

// user/get 批量读取的并发与限速：每批 5 个、批间休眠，控制在企微通讯录读取频率限制之内。
const USER_DETAIL_CHUNK_SIZE = 5;
const USER_DETAIL_CHUNK_INTERVAL_MS = 350;

/** 官方推荐链路：user/list_id（通讯录同步 secret）枚举 + user/get（自建应用 secret）逐人取详情 */
async function syncContactsViaListId(): Promise<WecomSyncResult> {
  const appToken = await getAccessToken();
  const contactSyncToken = await getContactSyncAccessToken();
  const { wecomDepts, wecomToLocalIdMap } = await syncDepartmentsFromWecom(appToken);

  const entries = await fetchWecomUserIdPages(contactSyncToken);
  const departmentsByUser = aggregateDepartmentsByUser(entries);
  const userids = [...departmentsByUser.keys()];

  const members: WecomUserMember[] = [];
  for (let i = 0; i < userids.length; i += USER_DETAIL_CHUNK_SIZE) {
    const chunk = userids.slice(i, i + USER_DETAIL_CHUNK_SIZE);
    const details = await Promise.all(chunk.map(async (userid): Promise<WecomUserMember> => {
      const fallbackDepartments = departmentsByUser.get(userid) || [];
      try {
        const raw = await fetchWecomUserDetailRaw(appToken, userid);
        return buildMemberFromUserGet(raw, fallbackDepartments);
      } catch (error: any) {
        // 单个成员详情读取失败不中断整体同步：按 ID 列表兜底建档，敏感资料留待下次同步或员工授权补全
        console.warn(`读取企业微信成员 ${userid} 详情失败，按成员ID列表兜底建档:`, error?.message || error);
        return {
          userid,
          name: null,
          email: null,
          mobile: null,
          status: null,
          departments: fallbackDepartments,
          jobNumber: null,
        };
      }
    }));
    members.push(...details);
    if (i + USER_DETAIL_CHUNK_SIZE < userids.length) {
      await new Promise((resolve) => setTimeout(resolve, USER_DETAIL_CHUNK_INTERVAL_MS));
    }
  }

  const applyResult = await applyWecomMembersToUsers(members, wecomToLocalIdMap, { clearMissingContactFields: false });
  return { mode: 'list_id', deptCount: wecomDepts.length, ...applyResult };
}

export async function syncContacts(mode: WecomSyncMode = 'legacy'): Promise<WecomSyncResult> {
  return mode === 'list_id' ? syncContactsViaListId() : syncContactsLegacy();
}

export async function sendWecomAppMessage(
  wecomUserIds: string[],
  title: string,
  description: string,
  url: string
): Promise<boolean> {
  if (wecomUserIds.length === 0) return false;

  const token = await getAccessToken();
  const config = await loadWecomConfig();

  if (!config || !config.wecomAgentId) {
    console.warn('未设置企业微信 AgentID，应用消息发送被忽略');
    return false;
  }

  const sendUrl = `${QYAPI_BASE}/message/send?access_token=${encodeURIComponent(token)}`;
  const payload = {
    touser: wecomUserIds.join('|'),
    msgtype: 'textcard',
    agentid: parseInt(config.wecomAgentId, 10),
    textcard: {
      title,
      description,
      url,
      btntxt: '立即处理'
    },
    safe: 0
  };

  const response = await fetch(sendUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json() as any;
  if (data.errcode && data.errcode !== 0) {
    console.error('发送企业微信应用消息失败:', data);
    return false;
  }

  return true;
}
