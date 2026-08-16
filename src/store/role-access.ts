import { AllowedAction, OrgUser, Role, User, UserRole } from '../types';
import { pageSupportsAction } from '../permissions/page-actions';

type RoleIdentity = Pick<User, 'roleId' | 'roleIds'>;

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  if (typeof value === 'string') {
    try {
      return normalizeStringArray(JSON.parse(value));
    } catch {
      return value.length > 0 ? [value] : [];
    }
  }
  return [];
}

export function getRoleByRoleId(roleId: string | undefined, roles: readonly Role[]): Role | null {
  if (!roleId) return null;
  return roles.find((role) => role.id === roleId) || null;
}

export function getAssignedRoleIds(user: RoleIdentity): string[] {
  return [...new Set([...normalizeStringArray(user.roleIds), user.roleId].filter((id): id is string => Boolean(id)))];
}

export function getRolesByUser(user: RoleIdentity, roles: readonly Role[]): Role[] {
  const assignedRoleIds = getAssignedRoleIds(user);
  return roles.filter(role => assignedRoleIds.includes(role.id));
}

export function getPrimaryRoleByUser(user: RoleIdentity, roles: readonly Role[]): Role | null {
  if (user.roleId) {
    const primaryRole = getRoleByRoleId(user.roleId, roles);
    if (primaryRole) return primaryRole;
  }

  const assignedRoleIds = normalizeStringArray(user.roleIds);
  for (const roleId of assignedRoleIds) {
    const matchedRole = getRoleByRoleId(roleId, roles);
    if (matchedRole) return matchedRole;
  }

  return null;
}

type DisplayRoleIdentity = {
  role: string;
  roleId?: string;
  roleIds?: string[];
};

export function getDisplayRoleName(
  user: DisplayRoleIdentity | Pick<OrgUser, 'role' | 'roleId' | 'roleIds'>,
  roles: readonly Role[],
): string {
  return getPrimaryRoleByUser(user, roles)?.name || user.role;
}

export function mapRoleIdentityToUserRole(user: { role: string; roleId?: string; roleIds?: string[] }): UserRole {
  const assignedRoleIds = getAssignedRoleIds(user);
  if (assignedRoleIds.includes('r1') || assignedRoleIds.includes('r4dtsn6m')) return 'ADMIN';
  if (assignedRoleIds.includes('r2')) return 'FOLLOWER';
  if (assignedRoleIds.length > 0) return 'OWNER';

  if (user.role === 'ADMIN' || user.role === '超级管理员' || user.role === '系统管理员' || user.role === '督办管理员') return 'ADMIN';
  if (user.role === 'FOLLOWER' || user.role === '督办专员' || user.role === '督办跟进人') return 'FOLLOWER';
  return 'OWNER';
}

export function getStrictUserAuthCodes(user: RoleIdentity, roles: readonly Role[]): string[] {
  return [...new Set(getRolesByUser(user, roles).flatMap(role => role.authCodes || []))];
}

export function canAccessByAuthCodes(
  user: RoleIdentity,
  roles: readonly Role[],
  requiredAuthCodes: string[],
): boolean {
  const authCodes = getStrictUserAuthCodes(user, roles);
  return authCodes.includes('ALL') || requiredAuthCodes.some((code) => authCodes.includes(code));
}

export function canUseAllowedAction(
  user: RoleIdentity,
  roles: readonly Role[],
  action: AllowedAction,
): boolean {
  const assignedRoles = getRolesByUser(user, roles);
  if (assignedRoles.length === 0) return false;
  return assignedRoles.some(role => {
    if (!role.allowedActions || role.allowedActions.length === 0) return true;
    return role.allowedActions.includes(action);
  });
}

export function canUsePageAction(
  user: RoleIdentity,
  roles: readonly Role[],
  pageAuth: string,
  action: AllowedAction,
): boolean {
  if (!pageSupportsAction(pageAuth, action)) return false;

  const assignedRoles = getRolesByUser(user, roles);
  if (assignedRoles.length === 0) return false;

  return assignedRoles.some((role) => {
    // 页面级配置优先：显式配置了页面按钮就以该配置为准（含内置管理员角色）。
    // 这样内置管理员的按钮级权限也能被独立放开/收口，而不是永远全量。
    const pageActions = role.allowedPageActions?.[pageAuth];
    if (Array.isArray(pageActions)) return pageActions.includes(action);
    // 未配置页面级时，ALL 视为全量放行；否则回退到全局 allowedActions。
    if (role.authCodes?.includes('ALL')) return true;
    // 空/未设置全局操作权限表示“无按钮授权”，不再等同于“全部允许”。
    if (!role.allowedActions || role.allowedActions.length === 0) return false;
    return role.allowedActions.includes(action);
  });
}
