import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { getUsersToCreate, isDuplicateUserError } from './users.sync';
import { AuthenticatedRequest } from './auth.middleware';
import { getCurrentAccessContext, invalidateAccessContextCache } from './access.context';
import { canManageUsers, canReadUsers } from './module-authz';
import { hashPassword } from './auth.password';
import { getPrimaryAssignedRole, resolveDisplayRoleName } from './role-identity';

export const usersRouter = Router();

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

// 获取所有用户（扁平列表）
usersRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canReadUsers(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无用户管理权限' });
    }
    const { users: usersTable, roles: rolesTable } = await import('../db/schema');
    const all = await db.select().from(usersTable);
    const roles = await db.select({ id: rolesTable.id, name: rolesTable.name }).from(rolesTable);
    const sanitizedUsers = all.map(({ password, ...user }: any) => ({
      ...user,
      role: resolveDisplayRoleName(user, roles),
      roleIds: parseStringArray(user.roleIds),
      adminOrgIds: parseStringArray(user.adminOrgIds),
    }));

    // 用户列表用于督办跟进人/责任人选择等场景，不应按事项数据权限过滤。
    // canReadUsers 已在入口处校验权限（需 MENU_WORKBENCH / MENU_ITEMS / MENU_ORG / MENU_SYSTEM 之一），
    // filterUsersByAccess 是为事项可见性设计，会让 SELF 数据范围的角色只能看到自己。
    return res.json(sanitizedUsers);
  } catch (error) {
    console.error('Get users error:', error);
    return res.status(500).json({ error: '获取用户列表失败' });
  }
});

// 新增用户
usersRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canManageUsers(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无用户管理权限' });
    }
    const { users: usersTable, roles: rolesTable } = await import('../db/schema');
    const { v4: uuid } = await import('uuid');

    const { id: clientId, name, username, role, roleId, email, phone, deptId, orgId, supervisorId, status } = req.body;
    const roles = await db.select({ id: rolesTable.id, name: rolesTable.name }).from(rolesTable);
    const resolvedRoleName = getPrimaryAssignedRole({ roleId }, roles)?.name || role || '普通员工';

    // 优先使用前端传入的 ID，保证前后端一致
    const id = clientId || uuid();
    await db.insert(usersTable).values({
      id,
      username,
      password: await hashPassword('123456'),
      name: name || '',
      role: resolvedRoleName,
      roleId: roleId || null,
      email: email || null,
      phone: phone || null,
      deptId: deptId || null,
      orgId: orgId || null,
      supervisorId: supervisorId || null,
      status: status || 'ACTIVE',
      createdAt: new Date(),
    } as any);
    invalidateAccessContextCache();

    return res.status(201).json({ id });
  } catch (error: any) {
    if (error?.errno === 1062) {
      return res.status(400).json({ error: '登录账号已存在' });
    }
    console.error('Create user error:', error);
    return res.status(500).json({ error: '新增用户失败' });
  }
});

// 批量新增用户
usersRouter.post('/batch', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canManageUsers(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无用户管理权限' });
    }
    const { users: usersTable, roles: rolesTable } = await import('../db/schema');
    const { v4: uuid } = await import('uuid');
    const { inArray, or } = await import('drizzle-orm');
    const { deptId, users } = req.body;
    const roles = await db.select({ id: rolesTable.id, name: rolesTable.name }).from(rolesTable);

    const now = new Date();
    const results: any[] = [];
    const incomingUsers = Array.isArray(users) ? users : [];

    if (incomingUsers.length === 0) {
      return res.status(201).json({ users: [] });
    }

    const incomingIds = incomingUsers.map(u => u.id).filter(Boolean);
    const incomingUsernames = incomingUsers.map(u => u.username).filter(Boolean);
    const conditions = [];
    if (incomingIds.length > 0) conditions.push(inArray(usersTable.id, incomingIds));
    if (incomingUsernames.length > 0) conditions.push(inArray(usersTable.username, incomingUsernames));

    const existingUsers = conditions.length > 0
      ? await db
          .select({ id: usersTable.id, username: usersTable.username })
          .from(usersTable)
          .where(conditions.length === 1 ? conditions[0] : or(...conditions))
      : [];

    const usersToCreate = getUsersToCreate(existingUsers, incomingUsers);

    for (const u of usersToCreate) {
      const id = u.id || uuid();
      try {
        const resolvedRoleName = getPrimaryAssignedRole({ roleId: u.roleId }, roles)?.name || u.role || '普通员工';
        await db.insert(usersTable).values({
          id,
          username: u.username,
          password: await hashPassword('123456'),
          name: u.name,
          role: resolvedRoleName,
          roleId: u.roleId || null,
          email: u.email || null,
          phone: u.phone || null,
          deptId: deptId || null,
          orgId: u.orgId || null,
          supervisorId: u.supervisorId || null,
          status: u.status || 'ACTIVE',
          createdAt: now,
        } as any);
        results.push({ id, name: u.name });
      } catch (error) {
        if (isDuplicateUserError(error)) continue;
        throw error;
      }
    }

    return res.status(201).json({ users: results });
  } catch (error: any) {
    console.error('Batch create users error:', error);
    return res.status(500).json({ error: '批量导入用户失败' });
  }
});

usersRouter.get('/me/preferences', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const { users: usersTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const [user] = await db
      .select({ preferences: usersTable.preferences })
      .from(usersTable)
      .where(eq(usersTable.id, req.authUser?.id || ''))
      .limit(1);

    return res.json(user?.preferences || {});
  } catch (error) {
    console.error('Get preferences error:', error);
    return res.status(500).json({ error: '获取偏好设置失败' });
  }
});

usersRouter.put('/me/preferences', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { site, email, sms } = req.body || {};
    if (![site, email, sms].every(value => typeof value === 'boolean')) {
      return res.status(400).json({ error: '偏好设置字段必须为布尔值' });
    }

    const db = await getDb();
    const { users: usersTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    await db
      .update(usersTable)
      .set({ preferences: { site, email, sms } } as never)
      .where(eq(usersTable.id, req.authUser?.id || ''));

    return res.json({ success: true });
  } catch (error) {
    console.error('Update preferences error:', error);
    return res.status(500).json({ error: '保存偏好设置失败' });
  }
});

// 更新用户
usersRouter.put('/:id', async (req: AuthenticatedRequest & Request<{ id: string }>, res: Response) => {
  try {
    const db = await getDb();
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canManageUsers(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无用户管理权限' });
    }
    const { users: usersTable, roles: rolesTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const { name, username, role, roleId, roleIds, email, phone, deptId, orgId, supervisorId, status, adminOrgIds } = req.body;
    const roles = await db.select({ id: rolesTable.id, name: rolesTable.name }).from(rolesTable);
    const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id)).limit(1);
    if (!targetUser) return res.status(404).json({ error: '用户不存在' });
    const requestedRoleIds = roleIds !== undefined ? parseStringArray(roleIds) : (roleId !== undefined ? (roleId ? [roleId] : []) : null);
    if (requestedRoleIds) {
      const validRoleIds = new Set(roles.map((item) => item.id));
      if (requestedRoleIds.some((id) => !validRoleIds.has(id))) return res.status(400).json({ error: '包含不存在的角色' });
      if (req.params.id === req.authUser?.id && requestedRoleIds.some((id) => ['r1', 'r4dtsn6m'].includes(id))) return res.status(403).json({ error: '不能为自己授予受保护管理员角色' });
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (username !== undefined) updates.username = username;
    if (role !== undefined) updates.role = role;
    if (roleId !== undefined) updates.roleId = roleId || null;
    if (roleIds !== undefined) updates.roleIds = parseStringArray(roleIds);
    if (email !== undefined) updates.email = email || null;
    if (phone !== undefined) updates.phone = phone || null;
    if (deptId !== undefined) updates.deptId = deptId || null;
    if (orgId !== undefined) updates.orgId = orgId || null;
    if (supervisorId !== undefined) updates.supervisorId = supervisorId || null;
    if (status !== undefined) updates.status = status;
    if (adminOrgIds !== undefined) updates.adminOrgIds = adminOrgIds || null;
    if (roleId !== undefined || roleIds !== undefined) {
      const resolvedRoleName = getPrimaryAssignedRole({ roleId, roleIds }, roles)?.name || (typeof role === 'string' ? role : undefined);
      if (resolvedRoleName) updates.role = resolvedRoleName;
    }
    if (status !== undefined || roleId !== undefined || roleIds !== undefined || adminOrgIds !== undefined) {
      updates.sessionVersion = (targetUser.sessionVersion ?? 0) + 1;
    }

    await db
      .update(usersTable)
      .set(updates as any)
      .where(eq(usersTable.id, req.params.id));

    invalidateAccessContextCache();

    return res.json({ success: true });
  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json({ error: '更新用户失败' });
  }
});

// 删除用户
usersRouter.delete('/:id', async (req: AuthenticatedRequest & Request<{ id: string }>, res: Response) => {
  try {
    const db = await getDb();
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canManageUsers(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无用户管理权限' });
    }
    const { users: usersTable, items: itemsTable, messages: messagesTable, urgeRecords, timelineNodes, operationLogs, messageUserStates } = await import('../db/schema');
    const { eq, or, sql } = await import('drizzle-orm');

    const [targetUser] = await db.select({ id: usersTable.id, status: usersTable.status, sessionVersion: usersTable.sessionVersion }).from(usersTable)
      .where(eq(usersTable.id, req.params.id)).limit(1);
    if (!targetUser) return res.status(404).json({ error: '用户不存在或已删除' });
    if (targetUser.id === req.authUser?.id) return res.status(403).json({ error: '不能删除当前登录账号' });

    // 督办、审批、消息均需可追溯。只要存在引用就必须停用，不允许物理删除制造孤儿记录。
    const referenceChecks = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(itemsTable).where(or(
        eq(itemsTable.issuerId, targetUser.id), eq(itemsTable.ownerId, targetUser.id),
        eq(itemsTable.followerId, targetUser.id), eq(itemsTable.deletedById, targetUser.id),
      )),
      db.select({ count: sql<number>`count(*)` }).from(messagesTable).where(or(
        eq(messagesTable.senderId, targetUser.id), eq(messagesTable.receiverId, targetUser.id),
      )),
      db.select({ count: sql<number>`count(*)` }).from(urgeRecords).where(or(
        eq(urgeRecords.senderId, targetUser.id), eq(urgeRecords.receiverId, targetUser.id),
      )),
      db.select({ count: sql<number>`count(*)` }).from(timelineNodes).where(eq(timelineNodes.actorUserId, targetUser.id)),
      db.select({ count: sql<number>`count(*)` }).from(operationLogs).where(eq(operationLogs.userId, targetUser.id)),
      db.select({ count: sql<number>`count(*)` }).from(messageUserStates).where(eq(messageUserStates.userId, targetUser.id)),
      db.select({ count: sql<number>`count(*)` }).from(usersTable).where(eq(usersTable.supervisorId, targetUser.id)),
    ]);
    const hasReferences = referenceChecks.some(([row]) => Number(row?.count || 0) > 0);
    if (hasReferences) {
      await db.update(usersTable)
        .set({ status: 'INACTIVE', sessionVersion: (targetUser.sessionVersion ?? 0) + 1 } as any)
        .where(eq(usersTable.id, targetUser.id));
      invalidateAccessContextCache();
      return res.json({ success: true, deactivated: true, notice: '该账号存在业务或审计关联，已停用以保留历史追溯，未执行物理删除' });
    }

    const deleteResult: any = await db
      .delete(usersTable)
      .where(eq(usersTable.id, req.params.id));

    const affectedRows = Number(
      deleteResult?.affectedRows ??
      deleteResult?.[0]?.affectedRows ??
      0
    );

    if (affectedRows === 0) {
      return res.status(404).json({ error: '用户不存在或已删除' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    return res.status(500).json({ error: '删除用户失败' });
  }
});
