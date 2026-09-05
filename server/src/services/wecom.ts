import { getDb } from '../db';
import { hashPassword } from '../routes/auth.password';
import { v4 as uuidv4 } from 'uuid';
import { resolveSyncTarget } from './wecom.sync-target';

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && now < tokenExpiresAt) {
    return cachedAccessToken;
  }

  const db = await getDb();
  const { globalRules: rulesTable } = await import('../db/schema');
  const [config] = await db.select().from(rulesTable).limit(1);

  if (!config || !config.wecomCorpId || !config.wecomCorpSecret) {
    throw new Error('未在系统全局配置中完整设置企业微信 CorpID 或 Secret');
  }

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(config.wecomCorpId)}&corpsecret=${encodeURIComponent(config.wecomCorpSecret)}`;
  const response = await fetch(url);
  const data = await response.json() as any;

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`获取企业微信 access_token 失败: [${data.errcode}] ${data.errmsg || '未知错误'}`);
  }

  cachedAccessToken = data.access_token;
  // 提前 5 分钟失效
  tokenExpiresAt = now + (data.expires_in - 300) * 1000;
  return cachedAccessToken!;
}

export async function getWecomUserIdByCode(code: string): Promise<string> {
  const token = await getAccessToken();
  const url = `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`;
  const response = await fetch(url);
  const data = await response.json() as any;

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`换取企业微信 UserID 失败: [${data.errcode}] ${data.errmsg || '未知错误'}`);
  }

  if (!data.userid && !data.UserId) {
    throw new Error('未从企业微信返回的身份数据中解析到有效的 UserID');
  }

  return data.userid || data.UserId;
}

export async function syncContacts(): Promise<{ deptCount: number; userCount: number; linkedByJobNumber: number }> {
  const token = await getAccessToken();
  const db = await getDb();
  const { eq } = await import('drizzle-orm');
  const { departments: deptTable, users: usersTable } = await import('../db/schema');

  // 1. 获取企业微信侧的所有部门
  const deptUrl = `https://qyapi.weixin.qq.com/cgi-bin/department/list?access_token=${encodeURIComponent(token)}`;
  const deptRes = await fetch(deptUrl);
  const deptData = await deptRes.json() as any;

  if (deptData.errcode && deptData.errcode !== 0) {
    throw new Error(`获取企业微信部门树失败: [${deptData.errcode}] ${deptData.errmsg || '未知错误'}`);
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

  // 3. 同步用户 (默认拉取根部门 ID 1 下的所有子部门成员，fetch_child=1)
  const userUrl = `https://qyapi.weixin.qq.com/cgi-bin/user/list?access_token=${encodeURIComponent(token)}&department_id=1&fetch_child=1`;
  const userRes = await fetch(userUrl);
  const userData = await userRes.json() as any;

  if (userData.errcode && userData.errcode !== 0) {
    throw new Error(`获取企业微信成员详情失败: [${userData.errcode}] ${userData.errmsg || '未知错误'}`);
  }

  const wecomUsers = userData.userlist || [];

  // 获取数据库现有用户：按 wecom_user_id 与登录账号（仅未关联账号，用于工号匹配）建立索引
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

  let linkedByJobNumber = 0;
  for (const wu of wecomUsers) {
    const wecomUserId = wu.userid;
    const decision = resolveSyncTarget(wu, userMap, usernameMap);

    // 解析用户的本地部门 ID（取其企业微信关联的首个部门进行映射）
    let localDeptId: string | null = null;
    if (wu.department && wu.department.length > 0) {
      localDeptId = wecomToLocalIdMap.get(String(wu.department[0])) || null;
    }

    if (decision.via === 'wecom_id') {
      // 已关联账号：姓名/邮箱/手机/部门/状态以企微为准（既有行为）
      await db.update(usersTable)
        .set({
          name: wu.name,
          email: wu.email || null,
          phone: wu.mobile || null,
          deptId: localDeptId,
          status: wu.status === 1 ? 'ACTIVE' : 'INACTIVE'
        } as any)
        .where(eq(usersTable.id, decision.targetId!));
      continue;
    }

    if (decision.via === 'job_number') {
      // 工号唯一命中未关联存量账号：仅回填 wecom_user_id 建立关联，不改动既有资料
      await db.update(usersTable)
        .set({ wecomUserId } as any)
        .where(eq(usersTable.id, decision.targetId!));
      linkedByJobNumber += 1;
      // 该登录账号已被占用，防止其他同工号成员重复绑到同一账号
      usernameMap.delete(String(wu.job_number ?? '').trim());
      continue;
    }

    // 不存在则创建新用户
    const newId = uuidv4();
    const randomPassword = uuidv4().slice(0, 16);
    const encryptedPassword = await hashPassword(randomPassword);

    await db.insert(usersTable).values({
      id: newId,
      username: wu.userid,
      password: encryptedPassword,
      name: wu.name,
      role: 'OWNER', // 默认分配承办人/责任人角色
      email: wu.email || null,
      phone: wu.mobile || null,
      deptId: localDeptId,
      wecomUserId: wu.userid,
      status: wu.status === 1 ? 'ACTIVE' : 'INACTIVE'
    } as any);
  }

  return {
    deptCount: wecomDepts.length,
    userCount: wecomUsers.length,
    linkedByJobNumber
  };
}

export async function sendWecomAppMessage(
  wecomUserIds: string[],
  title: string,
  description: string,
  url: string
): Promise<boolean> {
  if (wecomUserIds.length === 0) return false;

  const token = await getAccessToken();
  const db = await getDb();
  const { globalRules: rulesTable } = await import('../db/schema');
  const [config] = await db.select().from(rulesTable).limit(1);

  if (!config || !config.wecomAgentId) {
    console.warn('未设置企业微信 AgentID，应用消息发送被忽略');
    return false;
  }

  const sendUrl = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`;
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
