/**
 * 督办事项「可见范围」裁剪（后端移植，忠实复刻前端 src/store/item-access.ts 的 filterVisibleItems）。
 *
 * 用途：以某用户的身份（含角色数据范围）计算其在工作台可见的督办事项集合，
 * 使后端校验脚本能以「督办跟进人视角」等真实角色视角统计数量，与前端工作台一致。
 *
 * 移植说明：逻辑与前端保持一致；类型改用 server/src/types.ts（字段多为可选以兼容 DB 行）。
 */

import {
  DataScope,
  DeptNode,
  FollowerDataScope,
  OrgUser,
  Role,
  SupervisionItem,
  User,
  UserRole,
} from '../types';

type Scope = DataScope | FollowerDataScope;
type CurrentUserLike = User | OrgUser;

interface EffectiveRoleScope {
  dataScope: DataScope;
  followerDataScope?: FollowerDataScope;
  orgIds: string[];
  ownerCustomUserIds: string[];
  followerCustomUserIds: string[];
  customUserIds: string[];
}

const DATA_SCOPE_WEIGHT: Record<DataScope, number> = {
  SELF: 1,
  SELF_AND_DIRECT_SUBORDINATES: 2,
  DEPT: 3,
  MULTI_ORG: 4,
  ALL: 5,
};

const FOLLOWER_DATA_SCOPE_WEIGHT: Record<FollowerDataScope, number> = {
  SELF: 1,
  SELF_AND_DIRECT_SUBORDINATES: 2,
  DEPT: 3,
  MULTI_ORG: 4,
  ALL: 5,
};

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

function getRoleIdsOf(user: { roleId?: string | null; roleIds?: unknown }): string[] {
  return normalizeStringArray(user.roleIds).concat(user.roleId ? [user.roleId] : []);
}

function getRolesByUser(user: { roleId?: string | null; roleIds?: unknown }, roles: readonly Role[]): Role[] {
  const assignedRoleIds = [...new Set(getRoleIdsOf(user).filter(Boolean))];
  return roles.filter(role => assignedRoleIds.includes(role.id));
}

function pickMaxScope<T extends Scope>(scopes: T[], weight: Record<T, number>): T | undefined {
  return scopes.sort((a, b) => weight[b] - weight[a])[0];
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function getEffectiveRoleScope(currentUser: CurrentUserLike, roles: Role[]): EffectiveRoleScope | null {
  const assignedRoles = getRolesByUser(currentUser, roles);
  if (assignedRoles.length === 0) return null;

  return {
    dataScope: pickMaxScope(
      assignedRoles.map(role => role.dataScope).filter(Boolean) as DataScope[],
      DATA_SCOPE_WEIGHT,
    ) || 'SELF',
    followerDataScope: pickMaxScope(
      assignedRoles.map(role => role.followerDataScope).filter(Boolean) as FollowerDataScope[],
      FOLLOWER_DATA_SCOPE_WEIGHT,
    ),
    orgIds: unique(assignedRoles.flatMap(role => role.orgIds || [])),
    ownerCustomUserIds: unique(assignedRoles.flatMap(role => role.ownerCustomUserIds || [])),
    followerCustomUserIds: unique(assignedRoles.flatMap(role => role.followerCustomUserIds || [])),
    customUserIds: unique(assignedRoles.flatMap(role => role.customUserIds || [])),
  };
}

function getDeptAndChildDeptIds(departments: DeptNode[], deptId: string): string[] {
  const result = [deptId];
  const visited = new Set(result);

  const findNode = (nodes: DeptNode[]): DeptNode | null => {
    for (const node of nodes) {
      if (node.id === deptId) return node;
      const found = node.children ? findNode(node.children) : null;
      if (found) return found;
    }
    return null;
  };

  const collectTree = (node: DeptNode) => {
    node.children?.forEach(child => {
      if (visited.has(child.id)) return;
      visited.add(child.id);
      result.push(child.id);
      collectTree(child);
    });
  };

  const collectFlat = (parentId: string) => {
    departments.forEach(department => {
      if (department.parentId !== parentId || visited.has(department.id)) return;
      visited.add(department.id);
      result.push(department.id);
      collectFlat(department.id);
    });
  };

  const root = findNode(departments);
  if (root) collectTree(root);
  collectFlat(deptId);

  return result;
}

function getSubordinateUserIds(userId: string, orgUsers: OrgUser[], orgIds?: string[]): string[] {
  const result: string[] = [];
  const visited = new Set<string>();

  const collect = (supervisorId: string) => {
    orgUsers.forEach(user => {
      if (user.supervisorId !== supervisorId || user.status !== 'ACTIVE' || visited.has(user.id)) return;
      if (orgIds && orgIds.length > 0 && user.orgId && !orgIds.includes(user.orgId)) return;
      visited.add(user.id);
      result.push(user.id);
      collect(user.id);
    });
  };

  collect(userId);
  return result;
}

function getDeptUserIds(currentUser: CurrentUserLike, orgUsers: OrgUser[], departments: DeptNode[], customUserIds: string[] = []): string[] {
  const deptIds = currentUser.deptId ? getDeptAndChildDeptIds(departments, currentUser.deptId) : [];
  return unique([
    currentUser.id,
    ...orgUsers
      .filter(user => user.status === 'ACTIVE' && user.deptId && deptIds.includes(user.deptId))
      .map(user => user.id),
    ...customUserIds,
  ]);
}

function getEffectiveOrgIds(currentUser: CurrentUserLike, roleScope: EffectiveRoleScope): string[] {
  return currentUser.adminOrgIds && currentUser.adminOrgIds.length > 0
    ? currentUser.adminOrgIds
    : roleScope.orgIds;
}

function getScopeUserIds(
  scope: Scope | undefined,
  input: {
    currentUser: CurrentUserLike;
    orgUsers: OrgUser[];
    departments: DeptNode[];
    roleScope: EffectiveRoleScope;
    customUserIds?: string[];
  },
): string[] {
  const { currentUser, orgUsers, departments, roleScope, customUserIds = [] } = input;
  if (!scope) return [];
  if (scope === 'ALL') return orgUsers.filter(user => user.status === 'ACTIVE').map(user => user.id);
  if (scope === 'SELF') return [currentUser.id];
  if (scope === 'SELF_AND_DIRECT_SUBORDINATES') {
    const effectiveOrgIds = getEffectiveOrgIds(currentUser, roleScope);
    return unique([currentUser.id, ...getSubordinateUserIds(currentUser.id, orgUsers, effectiveOrgIds)]);
  }
  if (scope === 'DEPT') {
    return getDeptUserIds(currentUser, orgUsers, departments, customUserIds);
  }
  if (scope === 'MULTI_ORG') {
    const effectiveOrgIds = getEffectiveOrgIds(currentUser, roleScope);
    return orgUsers
      .filter(user => user.status === 'ACTIVE' && user.orgId && effectiveOrgIds.includes(user.orgId))
      .map(user => user.id);
  }
  return [];
}

function itemOwnerIds(item: SupervisionItem): string[] {
  return unique([item.ownerId, ...(item.ownerIds || [])]);
}

function itemFollowerIds(item: SupervisionItem): string[] {
  return unique([item.followerId, ...(item.followerIds || [])]);
}

function hasAnyMatch(values: string[], candidates: string[]): boolean {
  return values.some(value => candidates.includes(value));
}

function isSharedWithCurrentUser(item: SupervisionItem, currentUserId: string): boolean {
  return Boolean(item.sharedWith?.some(shared => shared.userId === currentUserId));
}

function isCurrentUserFollowerSupervisor(item: SupervisionItem, currentUserId: string, orgUsers: OrgUser[]): boolean {
  return itemFollowerIds(item).some(followerId => {
    const follower = orgUsers.find(user => user.id === followerId);
    return follower?.supervisorId === currentUserId && follower.status === 'ACTIVE';
  });
}

/**
 * 与前端 filterVisibleItems 完全一致：返回当前用户在督办工作台可见的督办事项。
 */
export function filterVisibleItems(input: {
  items: SupervisionItem[];
  currentUser: CurrentUserLike;
  orgUsers: OrgUser[];
  roles: Role[];
  departments: DeptNode[];
}): SupervisionItem[] {
  const { items, currentUser, orgUsers, roles, departments } = input;
  const currentUserRecord = orgUsers.find(user => user.id === currentUser.id) || currentUser;
  const roleScope = getEffectiveRoleScope(currentUserRecord, roles);
  if (!roleScope) return [];

  const ownerUserIds = getScopeUserIds(roleScope.dataScope, {
    currentUser: currentUserRecord,
    orgUsers,
    departments,
    roleScope,
    customUserIds: roleScope.ownerCustomUserIds.length > 0 ? roleScope.ownerCustomUserIds : roleScope.customUserIds,
  });
  const followerUserIds = getScopeUserIds(roleScope.followerDataScope, {
    currentUser: currentUserRecord,
    orgUsers,
    departments,
    roleScope,
    customUserIds: roleScope.followerCustomUserIds.length > 0 ? roleScope.followerCustomUserIds : roleScope.customUserIds,
  });

  return items.filter(item => {
    if (item.status === 'DELETED') return false;
    if (isSharedWithCurrentUser(item, currentUser.id)) return true;
    if (isCurrentUserFollowerSupervisor(item, currentUser.id, orgUsers)) return true;

    const ownerIds = itemOwnerIds(item);
    const followerIds = itemFollowerIds(item);

    if (roleScope.dataScope === 'ALL') return true;
    if (roleScope.dataScope === 'SELF') {
      return hasAnyMatch(ownerIds, [currentUser.id]) || hasAnyMatch(followerIds, [currentUser.id]);
    }
    if (roleScope.dataScope === 'SELF_AND_DIRECT_SUBORDINATES' || roleScope.dataScope === 'DEPT') {
      if (hasAnyMatch(ownerIds, ownerUserIds) || hasAnyMatch(followerIds, [currentUser.id])) return true;
    }
    if (roleScope.dataScope === 'MULTI_ORG' && hasAnyMatch(ownerIds, ownerUserIds)) return true;

    if (!roleScope.followerDataScope) return false;
    if (roleScope.followerDataScope === 'ALL') return true;
    if (roleScope.followerDataScope === 'DEPT') {
      return hasAnyMatch(ownerIds, followerUserIds) || hasAnyMatch(followerIds, followerUserIds);
    }
    if (roleScope.followerDataScope === 'MULTI_ORG') {
      return hasAnyMatch(followerIds, followerUserIds);
    }
    return hasAnyMatch(followerIds, followerUserIds);
  });
}

/**
 * 判定用户角色种类（复刻前端 mapRoleIdentityToUserRole），用于识别「督办跟进人」。
 */
export function getUserRoleKind(user: { role?: string; roleId?: string | null; roleIds?: unknown }, roles: readonly Role[]): UserRole {
  const assignedRoleIds = [...new Set(getRoleIdsOf(user).filter(Boolean))];
  if (assignedRoleIds.includes('r1') || assignedRoleIds.includes('r4dtsn6m')) return 'ADMIN';
  if (assignedRoleIds.includes('r2')) return 'FOLLOWER';
  if (assignedRoleIds.length > 0) return 'OWNER';

  const role = (user.role || '').toString();
  if (role === 'ADMIN' || role === '超级管理员' || role === '系统管理员' || role === '督办管理员') return 'ADMIN';
  if (role === 'FOLLOWER' || role === '督办专员' || role === '督办跟进人') return 'FOLLOWER';
  return 'OWNER';
}
