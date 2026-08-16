import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { createAuthToken } from './auth.session';
import { hashPassword, isPasswordHash, verifyPassword } from './auth.password';
import { AuthenticatedRequest, requireAuth } from './auth.middleware';
import { validatePasswordChangeInput } from './validation';
import { resolveDisplayRoleName } from './role-identity';

export const authRouter = Router();

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

authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    const db = await getDb();
    const { users: usersTable, roles: rolesTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, username))
      .limit(1);

    if (!user || !(await verifyPassword(password, user.password)) || user.status !== 'ACTIVE') {
      return res.status(401).json({ error: '账号不存在或已停用' });
    }

    if (!isPasswordHash(user.password)) {
      await db
        .update(usersTable)
        .set({ password: await hashPassword(password) } as never)
        .where(eq(usersTable.id, user.id));
    }

    const roleIds = parseStringArray(user.roleIds).length > 0
      ? parseStringArray(user.roleIds)
      : (user.roleId ? [user.roleId] : []);
    const adminOrgIds = parseStringArray(user.adminOrgIds);
    const roles = await db.select({ id: rolesTable.id, name: rolesTable.name }).from(rolesTable);
    const resolvedRoleName = resolveDisplayRoleName({ ...user, roleIds }, roles);

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
      token: createAuthToken({
        id: user.id,
        username: user.username,
        name: user.name,
        role: resolvedRoleName,
        roleId: user.roleId,
        roleIds,
        deptId: user.deptId,
        orgId: user.orgId,
        sessionVersion: user.sessionVersion ?? 0,
      }),
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: '登录失败' });
  }
});

authRouter.post('/change-password', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const validation = validatePasswordChangeInput(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const db = await getDb();
    const { users: usersTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.authUser?.id || ''))
      .limit(1);

    if (!user || !(await verifyPassword(req.body.oldPassword, user.password))) {
      return res.status(400).json({ error: '当前密码不正确' });
    }

    await db
      .update(usersTable)
      .set({ password: await hashPassword(req.body.newPassword) } as never)
      .where(eq(usersTable.id, user.id));

    return res.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: '修改密码失败' });
  }
});
