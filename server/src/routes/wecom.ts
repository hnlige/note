import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { createAuthToken } from './auth.session';
import { requireAuth, AuthenticatedRequest } from './auth.middleware';
import { requireModuleAccess } from './module-authz.middleware';
import { canManageGlobalRules } from './module-authz';
import { getWecomUserIdByCode, syncContacts } from '../services/wecom';
import { v4 as uuidv4 } from 'uuid';
import { resolveDisplayRoleName } from './role-identity';

export const wecomRouter = Router();

const requireWecomManage = requireModuleAccess(canManageGlobalRules, '当前账号无企业微信同步管理权限');

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  if (typeof value === 'string') {
    try {
      return parseStringArray(JSON.parse(value));
    } catch {
      return value.length > 0 ? [value] : [];
    }
  }
  return [];
}

// 1. 企业微信 H5 免登登录接口
wecomRouter.post('/login', async (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: '免登授权凭证 code 缺失' });
  }

  try {
    const wecomUserId = await getWecomUserIdByCode(code);

    const db = await getDb();
    const { users: usersTable, roles: rolesTable } = await import('../db/schema');
    const { eq, or } = await import('drizzle-orm');

    // 匹配本系统账号
    // 历史通讯录导入的账号可能已有与企业微信一致的 username，但尚未填充
    // wecom_user_id。仅按 wecom_user_id 会让这些账号在移动端免登后被误判为未建档。
    const [user] = await db
      .select()
      .from(usersTable)
      .where(or(
        eq(usersTable.wecomUserId as any, wecomUserId),
        eq(usersTable.username, wecomUserId),
      ))
      .limit(1);

    if (!user) {
      return res.status(401).json({
        error: '您的企业微信账号未开通或未在本系统关联，请联系管理员在系统后台同步通讯录'
      });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(401).json({ error: '您的督办系统账号已被禁用' });
    }

    // 首次通过 username 兜底匹配成功后补齐映射，后续登录走稳定的 wecom_user_id。
    if (!user.wecomUserId) {
      await db.update(usersTable)
        .set({ wecomUserId } as any)
        .where(eq(usersTable.id, user.id));
    }

    const roleIds = parseStringArray(user.roleIds).length > 0
      ? parseStringArray(user.roleIds)
      : (user.roleId ? [user.roleId] : []);
    const adminOrgIds = parseStringArray(user.adminOrgIds);
    const roles = await db.select({ id: rolesTable.id, name: rolesTable.name }).from(rolesTable);
    const resolvedRoleName = resolveDisplayRoleName({ ...user, roleIds }, roles);

    // 签发业务 Token
    const token = createAuthToken({
      id: user.id,
      username: user.username,
      name: user.name,
      role: resolvedRoleName,
      roleId: user.roleId,
      roleIds,
      deptId: user.deptId,
      orgId: user.orgId,
      sessionVersion: user.sessionVersion ?? 0,
    });

    return res.json({
        id: user.id,
        username: user.username,
        name: user.name,
        role: resolvedRoleName,
        roleId: user.roleId,
      roleIds,
      deptId: user.deptId,
      orgId: user.orgId,
      adminOrgIds,
      token
    });
  } catch (error: any) {
    console.error('Wecom login error:', error);
    return res.status(500).json({ error: error.message || '企业微信免登处理失败' });
  }
});

// 2. 企业微信通讯录同步接口 (管理员/有 Wecom 菜单权限者调用)
wecomRouter.post('/sync', requireAuth, requireWecomManage, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const { asyncTasks: taskTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    
    // 建立异步任务记录以便于后台监控
    const taskId = uuidv4();
    await db.insert(taskTable).values({
      id: taskId,
      name: '企业微信通讯录同步',
      module: '组织架构',
      status: 'PROCESSING',
      progress: 10,
      startTime: new Date()
    } as any);

    // 异步执行，不阻塞 HTTP 响应 (企业微信要求同步动作秒级返回)
    syncContacts()
      .then(async (result) => {
        const upDb = await getDb();
        const { asyncTasks: uTaskTable } = await import('../db/schema');
        await upDb.update(uTaskTable)
          .set({
            status: 'COMPLETED',
            progress: 100,
            result: `同步成功：共导入/更新 ${result.deptCount} 个部门，${result.userCount} 位成员`
              + (result.linkedByJobNumber ? `，按工号关联存量账号 ${result.linkedByJobNumber} 个` : '')
              + '。',
            endTime: new Date()
          } as any)
          .where(eq(uTaskTable.id, taskId));
      })
      .catch(async (err: any) => {
        console.error('Sync contacts background error:', err);
        const errDb = await getDb();
        const { asyncTasks: eTaskTable } = await import('../db/schema');
        await errDb.update(eTaskTable)
          .set({
            status: 'FAILED',
            progress: 100,
            result: `同步失败：${err.message || '未知错误'}`,
            endTime: new Date()
          } as any)
          .where(eq(eTaskTable.id, taskId));
      });

    return res.json({
      ok: true,
      message: '企业微信通讯录同步任务已提交，系统正在后台异步拉取，请在后台任务监控查看详情',
      taskId
    });
  } catch (error: any) {
    console.error('Wecom sync init error:', error);
    return res.status(500).json({ error: error.message || '企业微信同步任务提交失败' });
  }
});

// 3. 获取基础 WeCom 公共配置以发起重定向
wecomRouter.get('/config', async (_req, res) => {
  try {
    const db = await getDb();
    const { globalRules: rulesTable } = await import('../db/schema');
    const [config] = await db.select().from(rulesTable).limit(1);
    return res.json({
      wecomCorpId: config?.wecomCorpId || '',
      wecomAgentId: config?.wecomAgentId || ''
    });
  } catch (error) {
    console.error('Get wecom public config error:', error);
    return res.status(500).json({ error: '获取企业微信公共配置失败' });
  }
});
