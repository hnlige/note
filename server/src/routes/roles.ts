import { Router, Request, Response, NextFunction } from 'express';
import { getDb } from '../db';
import { AuthenticatedRequest } from './auth.middleware';
import { getCurrentAccessContext, invalidateAccessContextCache } from './access.context';
import { canManageRoles, canViewRoles } from './module-authz';
import { getAssignedRoleIds } from './role-identity';
import { PAGE_ACTION_CATALOG, asStringArray } from './page-actions';

export const rolesRouter = Router();

export function getRoleWriteAffectedRows(result: unknown): number | null {
  const candidate = Array.isArray(result) ? result[0] : result;
  if (candidate && typeof candidate === 'object' && 'affectedRows' in candidate) {
    const affectedRows = Number((candidate as { affectedRows?: unknown }).affectedRows);
    return Number.isFinite(affectedRows) ? affectedRows : null;
  }
  return null;
}

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

export const FAIL_CLOSED_ALLOWED_ACTIONS = ['__INVALID_ALLOWED_ACTIONS__'] as const;

// 内置管理员角色（拥有 ALL 菜单和全局数据范围）禁止被删除或降级，避免任何角色管理员
// 误操作造成系统锁死。名称、说明等非授权元数据仍可正常维护。
const PROTECTED_ADMIN_ROLE_IDS = new Set(['r1', 'r4dtsn6m']);
const PROTECTED_ADMIN_PRIVILEGE_FIELDS = [
  'permissions', 'dataScope', 'followerDataScope', 'allowedActions',
  'orgIds', 'customUserIds', 'ownerCustomUserIds', 'followerCustomUserIds',
];

/**
 * 判断对某个角色的特权字段修改是否触达内置管理员保护。
 * 返回被修改的受保护字段名；角色非内置管理员或未改动授权字段时返回 null。
 */
export function detectProtectedAdminPrivilegeChange(
  roleId: string,
  existing: any,
  incoming: Record<string, unknown>,
): string | null {
  if (!PROTECTED_ADMIN_ROLE_IDS.has(roleId)) return null;
  const changed = PROTECTED_ADMIN_PRIVILEGE_FIELDS.find((field) => {
    if (!(field in (incoming || {}))) return false;
    return !isPrivilegeFieldUnchanged(field, existing, incoming);
  });
  return changed ?? null;
}

/**
 * 将角色物化为“页面级按钮权限”，用于与前端配置 UI 的物化结果做等价比较。
 * 旧数据只有全局 allowedActions、没有 allowedPageActions；前端在加载时会把有效授权
 * 铺开为显式页面级列表，因此后端比对时也用同一规则，避免幂等重存被误判为“修改”。
 */
function materializePageActionsForComparison(role: any): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [pageAuth, supported] of PAGE_ACTION_CATALOG) {
    const existing = parseAllowedPageActions(role?.allowedPageActions)[pageAuth];
    if (Array.isArray(existing)) {
      result[pageAuth] = existing.slice().sort();
      continue;
    }
    const authCodes = asStringArray(role?.permissions).concat(asStringArray(role?.authCodes));
    if (authCodes.includes('ALL')) {
      result[pageAuth] = supported.slice().sort();
      continue;
    }
    const globalActions = asStringArray(role?.allowedActions);
    if (globalActions.length > 0) {
      const filtered = supported.filter((action) => globalActions.includes(action)).sort();
      if (filtered.length > 0) result[pageAuth] = filtered;
    }
  }
  return result;
}

/** 判断某个特权字段在 incoming 与 existing 之间是否“未变化”（用于内置管理员保护）。 */
function isPrivilegeFieldUnchanged(field: string, existing: any, incoming: any): boolean {
  if (field === 'allowedPageActions') {
    return JSON.stringify(materializePageActionsForComparison(incoming)) === JSON.stringify(materializePageActionsForComparison(existing));
  }
  if (field === 'dataScope' || field === 'followerDataScope') {
    return (incoming[field] ?? null) === (existing[field] ?? null);
  }
  const normalizeArray = (value: unknown) => parseStringArray(value).slice().sort();
  return JSON.stringify(normalizeArray(incoming[field])) === JSON.stringify(normalizeArray(existing[field]));
}

function parseStrictStringArray(value: unknown): string[] | null {
  let parsedValue = value;
  if (typeof value === 'string') {
    try {
      parsedValue = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (
    !Array.isArray(parsedValue)
    || !parsedValue.every((item) => typeof item === 'string' && item.trim().length > 0)
  ) {
    return null;
  }

  return [...parsedValue] as string[];
}

function parseAllowedActionsForWrite(value: unknown): string[] {
  const parsed = parseStrictStringArray(value);
  if (parsed === null) {
    throw new TypeError('allowedActions must be an array of non-empty strings or a JSON array');
  }
  return parsed;
}

function normalizeAllowedActionsForRead(value: unknown): string[] {
  return parseStrictStringArray(value) ?? [...FAIL_CLOSED_ALLOWED_ACTIONS];
}

export function getAllowedActionsUpdate(input: { allowedActions?: unknown }): { allowedActions?: string[] } {
  if (input.allowedActions === undefined) return {};
  return { allowedActions: parseAllowedActionsForWrite(input.allowedActions) };
}

function validateAllowedActionsBody(req: Request, res: Response, next: NextFunction) {
  if (req.body?.allowedActions === undefined) return next();

  try {
    parseAllowedActionsForWrite(req.body.allowedActions);
    return next();
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'allowedActions 格式错误',
    });
  }
}

export function parseAllowedPageActions(value: unknown): Record<string, string[]> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return parseAllowedPageActions(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, actions]) => Array.isArray(actions))
      .map(([pageAuth, actions]) => [pageAuth, parseStringArray(actions)])
      .filter(([, actions]) => actions.length > 0),
  );
}

export function normalizeRoleResponse(role: any) {
  const ownerCustomUserIds = parseStringArray(role.ownerCustomUserIds);
  const followerCustomUserIds = parseStringArray(role.followerCustomUserIds);
  const legacyCustomUserIds = parseStringArray(role.customUserIds);

  return {
    ...role,
    permissions: parseStringArray(role.permissions),
    allowedActions: normalizeAllowedActionsForRead(role.allowedActions),
    allowedPageActions: parseAllowedPageActions(role.allowedPageActions),
    orgIds: parseStringArray(role.orgIds),
    ownerCustomUserIds: ownerCustomUserIds.length > 0 ? ownerCustomUserIds : legacyCustomUserIds,
    followerCustomUserIds: followerCustomUserIds.length > 0 ? followerCustomUserIds : legacyCustomUserIds,
    customUserIds: legacyCustomUserIds,
  };
}

rolesRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentUser) {
      return res.status(403).json({ error: '当前账号无角色查看权限' });
    }
    const { roles: rolesTable } = await import('../db/schema');
    const all = (await db.select().from(rolesTable)).map(normalizeRoleResponse);

    // 拥有角色管理/查看权限的账号返回全部角色；普通账号至少返回自己关联的角色，
    // 这样前端登录后能同步到后台实际分配的权限配置，而不是一直使用本地初始权限。
    if (accessContext.currentRole && canViewRoles(accessContext.currentRole)) {
      return res.json(all);
    }

    const assignedRoleIds = new Set(getAssignedRoleIds(accessContext.currentUser));

    return res.json(all.filter((role: { id: string }) => assignedRoleIds.has(role.id)));
  } catch (error) {
    console.error('Get roles error:', error);
    return res.status(500).json({ error: '获取角色列表失败' });
  }
});

function getRoleCustomUserFields(input: {
  customUserIds?: unknown;
  ownerCustomUserIds?: unknown;
  followerCustomUserIds?: unknown;
}) {
  const legacyCustomUserIds = parseStringArray(input.customUserIds);
  const ownerCustomUserIds = 'ownerCustomUserIds' in input
    ? parseStringArray(input.ownerCustomUserIds)
    : legacyCustomUserIds;
  const followerCustomUserIds = 'followerCustomUserIds' in input
    ? parseStringArray(input.followerCustomUserIds)
    : legacyCustomUserIds;

  return {
    ownerCustomUserIds,
    followerCustomUserIds,
    customUserIds: [...new Set([...ownerCustomUserIds, ...followerCustomUserIds, ...legacyCustomUserIds])],
  };
}

export function buildRoleInsertValues(input: {
  id?: string;
  name: string;
  description?: string;
  permissions?: unknown;
  dataScope?: string;
  followerDataScope?: string | null;
  allowedActions?: unknown;
  allowedPageActions?: unknown;
  orgIds?: unknown;
  customUserIds?: unknown;
  ownerCustomUserIds?: unknown;
  followerCustomUserIds?: unknown;
}, fallbackId: string, createdAt = new Date()) {
  const customUserFields = getRoleCustomUserFields({
    customUserIds: input.customUserIds,
    ownerCustomUserIds: input.ownerCustomUserIds,
    followerCustomUserIds: input.followerCustomUserIds,
  });

  return {
    id: input.id || fallbackId,
    name: input.name,
    description: input.description || '',
    permissions: parseStringArray(input.permissions || []),
    dataScope: input.dataScope || 'SELF',
    followerDataScope: input.followerDataScope || null,
    allowedActions: input.allowedActions === undefined
      ? []
      : parseAllowedActionsForWrite(input.allowedActions),
    allowedPageActions: parseAllowedPageActions(input.allowedPageActions),
    orgIds: parseStringArray(input.orgIds || []),
    ...customUserFields,
    createdAt,
  };
}

rolesRouter.post('/', validateAllowedActionsBody, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canManageRoles(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无角色管理权限' });
    }
    if (typeof req.body?.id === 'string' && PROTECTED_ADMIN_ROLE_IDS.has(req.body.id)) {
      return res.status(400).json({ error: '不可使用内置管理员角色ID创建角色' });
    }
    const { roles: rolesTable } = await import('../db/schema');
    const {
      id: clientId,
      name,
      description,
      permissions,
      dataScope,
      followerDataScope,
      allowedActions,
      allowedPageActions,
      orgIds,
      customUserIds,
      ownerCustomUserIds,
      followerCustomUserIds,
    } = req.body;
    const { v4: uuid } = await import('uuid');
    await db.insert(rolesTable).values(buildRoleInsertValues({
      id: clientId,
      name,
      description,
      permissions,
      dataScope,
      followerDataScope,
      allowedActions,
      allowedPageActions,
      orgIds,
      customUserIds,
      ownerCustomUserIds,
      followerCustomUserIds,
    }, uuid()) as any);
    invalidateAccessContextCache();
    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('Create role error:', error);
    return res.status(500).json({ error: '新增角色失败' });
  }
});

rolesRouter.put('/:id', validateAllowedActionsBody, async (req: AuthenticatedRequest & Request<{ id: string }>, res: Response) => {
  try {
    const db = await getDb();
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canManageRoles(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无角色管理权限' });
    }
    // 内置管理员的任一授权字段变更必须明确拒绝，不能静默部分成功。
    if (PROTECTED_ADMIN_ROLE_IDS.has(req.params.id)) {
      const { roles: rolesTable } = await import('../db/schema');
      const { eq } = await import('drizzle-orm');
      const [existingRoleRow] = await db.select().from(rolesTable).where(eq(rolesTable.id, req.params.id)).limit(1);
      if (existingRoleRow) {
        const normalizedExisting = normalizeRoleResponse(existingRoleRow);
        const changedPrivilege = detectProtectedAdminPrivilegeChange(req.params.id, normalizedExisting, req.body || {});
        if (changedPrivilege) {
          return res.status(403).json({ error: `内置管理员角色的授权字段受保护，不能修改：${changedPrivilege}` });
        }
      }
    }
    const { roles: rolesTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const {
      name,
      description,
      permissions,
      dataScope,
      followerDataScope,
      allowedActions,
      allowedPageActions,
      orgIds,
      customUserIds,
      ownerCustomUserIds,
      followerCustomUserIds,
    } = req.body;
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (permissions !== undefined) updates.permissions = parseStringArray(permissions);
    if (dataScope !== undefined) updates.dataScope = dataScope;
    Object.assign(updates, getAllowedActionsUpdate({ allowedActions }));
    if (allowedPageActions !== undefined) updates.allowedPageActions = parseAllowedPageActions(allowedPageActions);
    if ('followerDataScope' in req.body) updates.followerDataScope = followerDataScope ?? null;
    if (orgIds !== undefined) updates.orgIds = parseStringArray(orgIds);
    if (customUserIds !== undefined || ownerCustomUserIds !== undefined || followerCustomUserIds !== undefined) {
      Object.assign(updates, getRoleCustomUserFields({ customUserIds, ownerCustomUserIds, followerCustomUserIds }));
    }
    if (Object.keys(updates).length > 0) {
      const [existingRole] = await db.select({ id: rolesTable.id }).from(rolesTable).where(eq(rolesTable.id, req.params.id)).limit(1);
      if (!existingRole) {
        return res.status(404).json({ error: '角色不存在或尚未创建成功' });
      }
      await db.update(rolesTable).set(updates).where(eq(rolesTable.id, req.params.id));
      invalidateAccessContextCache();
      if (typeof updates.name === 'string' && updates.name.trim().length > 0) {
        const { users: usersTable } = await import('../db/schema');
        await db.update(usersTable).set({ role: updates.name.trim() } as any).where(eq(usersTable.roleId, req.params.id));
      }
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Update role error:', error);
    return res.status(500).json({ error: '更新角色失败' });
  }
});

rolesRouter.delete('/:id', async (req: AuthenticatedRequest & Request<{ id: string }>, res: Response) => {
  try {
    const db = await getDb();
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canManageRoles(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无角色管理权限' });
    }
    if (PROTECTED_ADMIN_ROLE_IDS.has(req.params.id)) {
      return res.status(403).json({ error: '内置管理员角色不可删除' });
    }
    const { roles: rolesTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    await db.delete(rolesTable).where(eq(rolesTable.id, req.params.id));
    invalidateAccessContextCache();
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete role error:', error);
    return res.status(500).json({ error: '删除角色失败' });
  }
});
