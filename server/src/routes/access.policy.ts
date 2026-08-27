import { and, inArray, or, sql, type SQL } from 'drizzle-orm';
import { parseAllowedActions, parseAllowedPageActions } from './page-actions';

export interface AccessUserLike {
  id: string;
  roleId?: string | null;
  roleIds?: unknown[];
  orgId?: string | null;
  deptId?: string | null;
  supervisorId?: string | null;
  status?: string | null;
  adminOrgIds?: unknown[];
}

export interface AccessRoleLike {
  id: string;
  permissions?: unknown[];
  dataScope?: string | null;
  followerDataScope?: string | null;
  orgIds?: unknown[];
  ownerCustomUserIds?: unknown[];
  followerCustomUserIds?: unknown[];
  customUserIds?: unknown[];
  allowedActions?: unknown;
  allowedPageActions?: unknown;
}

export interface AccessItemLike {
  id: string;
  ownerId?: string | null;
  followerId?: string | null;
  ownerIds?: string[] | null;
  followerIds?: string[] | null;
  sharedWith?: unknown[] | null;
  deletedAt?: unknown;
}

export interface AccessDepartmentLike {
  id: string;
  parentId?: string | null;
  children?: AccessDepartmentLike[] | null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      return asStringArray(JSON.parse(trimmed));
    } catch {
      return [trimmed];
    }
  }
  return [];
}

function isActiveUser(user: AccessUserLike): boolean {
  return !user.status || user.status === 'ACTIVE';
}

function getSelfAndDescendantSubordinateIds(userId: string, users: AccessUserLike[], orgIds?: string[]): string[] {
  const result = [userId];
  const visited = new Set(result);

  const collect = (supervisorId: string) => {
    users.forEach((user) => {
      if (user.supervisorId !== supervisorId || !isActiveUser(user) || !user.id || visited.has(user.id)) {
        return;
      }
      if (orgIds && orgIds.length > 0 && user.orgId && !orgIds.includes(user.orgId)) {
        return;
      }
      visited.add(user.id);
      result.push(user.id);
      collect(user.id);
    });
  };

  collect(userId);
  return result;
}

function getDeptAndChildDeptIds(departments: AccessDepartmentLike[] | undefined, deptId: string): string[] {
  if (!departments || departments.length === 0) return [deptId];

  const result = [deptId];
  const visited = new Set(result);

  const collectFromFlatList = (parentId: string) => {
    departments.forEach((department) => {
      if (department.parentId !== parentId || !department.id || visited.has(department.id)) {
        return;
      }
      visited.add(department.id);
      result.push(department.id);
      collectFromFlatList(department.id);
    });
  };

  const findNode = (nodes: AccessDepartmentLike[]): AccessDepartmentLike | null => {
    for (const node of nodes) {
      if (node.id === deptId) return node;
      const found = node.children ? findNode(node.children) : null;
      if (found) return found;
    }
    return null;
  };

  const collectFromTree = (node: AccessDepartmentLike) => {
    node.children?.forEach((child) => {
      if (!child.id || visited.has(child.id)) return;
      visited.add(child.id);
      result.push(child.id);
      collectFromTree(child);
    });
  };

  collectFromFlatList(deptId);
  const root = findNode(departments);
  if (root) collectFromTree(root);

  return result;
}

function getDeptScopedUserIds(currentUser: AccessUserLike, users: AccessUserLike[], departments?: AccessDepartmentLike[]): string[] {
  if (!currentUser.deptId) return [currentUser.id];
  const deptIds = getDeptAndChildDeptIds(departments, currentUser.deptId);
  return users
    .filter((user) => user.deptId && deptIds.includes(user.deptId) && isActiveUser(user))
    .map((user) => user.id);
}

function getDeptAndDescendantSubordinateIds(currentUser: AccessUserLike, users: AccessUserLike[], customUserIds: string[] = [], departments?: AccessDepartmentLike[]): string[] {
  return [...new Set([
    ...getDeptScopedUserIds(currentUser, users, departments),
    // 部门管理员既管理本部门及下级部门，也应能查看其汇报链上的下级人员。
    // 汇报关系可能跨部门（例如上级被授权为部门管理员、下属仍归属其他科室），
    // 不能仅依赖 deptId/部门树，否则责任人事项会被错误过滤。
    ...getSelfAndDescendantSubordinateIds(currentUser.id, users),
    ...customUserIds,
  ])];
}

function getDeptAndDescendantSubordinateFollowers(currentUser: AccessUserLike, users: AccessUserLike[], customUserIds: string[] = [], departments?: AccessDepartmentLike[]): string[] {
  return getDeptAndDescendantSubordinateIds(currentUser, users, customUserIds, departments);
}

function isDeptManagerLike(currentUser: AccessUserLike, currentRole: AccessRoleLike): boolean {
  const assignedRoleIds = asStringArray(currentUser.roleIds);
  return currentUser.roleId === 'r3' ||
    assignedRoleIds.includes('r3') ||
    currentRole.id === 'r3' ||
    currentRole.dataScope === 'DEPT' ||
    currentRole.followerDataScope === 'DEPT';
}

function getDeptManagerOwnerCustomUserIds(currentRole: AccessRoleLike): string[] {
  const ownerCustomUserIds = asStringArray(currentRole.ownerCustomUserIds);
  return ownerCustomUserIds.length > 0 ? ownerCustomUserIds : asStringArray(currentRole.customUserIds);
}

function getDeptManagerFollowerCustomUserIds(currentRole: AccessRoleLike): string[] {
  const followerCustomUserIds = asStringArray(currentRole.followerCustomUserIds);
  return followerCustomUserIds.length > 0 ? followerCustomUserIds : asStringArray(currentRole.customUserIds);
}

function getOwnerScopeSubjectIds(
  currentUser: AccessUserLike,
  currentRole: AccessRoleLike,
  users: AccessUserLike[],
  departments?: AccessDepartmentLike[],
): string[] {
  const scope = currentRole.dataScope || 'SELF';

  if (scope === 'ALL') return users.filter(isActiveUser).map((user) => user.id);
  if (scope === 'SELF') return [currentUser.id];
  if (scope === 'SELF_AND_DIRECT_SUBORDINATES') {
    // P1-3: 传递用户级 adminOrgIds，下属列表按组织交集裁剪
    const orgIds = asStringArray(currentUser.adminOrgIds);
    return getSelfAndDescendantSubordinateIds(currentUser.id, users, orgIds.length > 0 ? orgIds : undefined);
  }
  if (scope === 'DEPT') {
    if (isDeptManagerLike(currentUser, currentRole)) {
      return getDeptAndDescendantSubordinateIds(currentUser, users, getDeptManagerOwnerCustomUserIds(currentRole), departments);
    }
    if (!currentUser.deptId) return [currentUser.id];
    const deptIds = getDeptAndChildDeptIds(departments, currentUser.deptId);
    return users.filter((user) => user.deptId && deptIds.includes(user.deptId) && isActiveUser(user)).map((user) => user.id);
  }
  // 责任人维度 MULTI_ORG — 先检用户级 adminOrgIds，再回退到角色级 orgIds
  if (scope === 'MULTI_ORG') {
    const currentUserRecord = users.find(u => u.id === currentUser.id) || currentUser;
    const orgIds = getEffectiveOrgIds(currentUserRecord, currentRole);
    return users.filter((user) => user.orgId && orgIds.includes(user.orgId) && isActiveUser(user)).map((user) => user.id);
  }

  return [currentUser.id];
}

function getFollowerScopeSubjectIds(
  currentUser: AccessUserLike,
  currentRole: AccessRoleLike,
  users: AccessUserLike[],
  departments?: AccessDepartmentLike[],
): string[] {
  const scope = currentRole.followerDataScope;
  if (!scope) return [];

  if (scope === 'ALL') return users.filter(isActiveUser).map((user) => user.id);
  if (scope === 'SELF') return [currentUser.id];
  if (scope === 'SELF_AND_DIRECT_SUBORDINATES') {
    // P1-3: 传递用户级 adminOrgIds，下属列表按组织交集裁剪
    const orgIds = asStringArray(currentUser.adminOrgIds);
    return getSelfAndDescendantSubordinateIds(currentUser.id, users, orgIds.length > 0 ? orgIds : undefined);
  }
  if (scope === 'DEPT') {
    if (isDeptManagerLike(currentUser, currentRole)) {
      return getDeptAndDescendantSubordinateFollowers(currentUser, users, getDeptManagerFollowerCustomUserIds(currentRole), departments);
    }
    if (!currentUser.deptId) return [currentUser.id];
    const deptIds = getDeptAndChildDeptIds(departments, currentUser.deptId);
    return users.filter((user) => user.deptId && deptIds.includes(user.deptId) && isActiveUser(user)).map((user) => user.id);
  }
  if (scope === 'MULTI_ORG') {
    // 跟进人维度 MULTI_ORG — 先检用户级 adminOrgIds，再回退到角色级 orgIds
    const currentUserRecord = users.find(u => u.id === currentUser.id) || currentUser;
    const orgIds = getEffectiveOrgIds(currentUserRecord, currentRole);
    return users.filter((user) => user.orgId && orgIds.includes(user.orgId) && isActiveUser(user)).map((user) => user.id);
  }

  return [];
}

function matchesOwner(item: AccessItemLike, userIds: string[]): boolean {
  if (userIds.length === 0) return false;
  const owners = [item.ownerId, ...(item.ownerIds || [])].filter((value): value is string => Boolean(value));
  return owners.some((id) => userIds.includes(id));
}

function matchesFollower(item: AccessItemLike, userIds: string[]): boolean {
  if (userIds.length === 0) return false;
  const followers = [item.followerId, ...(item.followerIds || [])].filter((value): value is string => Boolean(value));
  return followers.some((id) => userIds.includes(id));
}

function matchesFollowerSupervisor(item: AccessItemLike, currentUserId: string, users: AccessUserLike[]): boolean {
  const followers = [item.followerId, ...(item.followerIds || [])].filter((value): value is string => Boolean(value));
  return followers.some((followerId) => {
    const follower = users.find((user) => user.id === followerId);
    return follower?.supervisorId === currentUserId && isActiveUser(follower);
  });
}

function matchesSharedUser(item: AccessItemLike, currentUserId: string): boolean {
  return asStringArray((item.sharedWith || []).map((shared: any) => shared?.userId)).includes(currentUserId);
}

function matchesUsersInOrg(userIds: Array<string | null | undefined>, users: AccessUserLike[], orgIds: string[]): boolean {
  if (orgIds.length === 0) return false;
  return userIds
    .filter((value): value is string => Boolean(value))
    .some((userId) => {
      const user = users.find((candidate) => candidate.id === userId);
      return Boolean(user?.orgId && orgIds.includes(user.orgId));
    });
}

function matchesOwnerOrg(item: AccessItemLike, users: AccessUserLike[], orgIds: string[]): boolean {
  return matchesUsersInOrg([item.ownerId, ...(item.ownerIds || [])], users, orgIds);
}

function matchesFollowerOrg(item: AccessItemLike, users: AccessUserLike[], orgIds: string[]): boolean {
  return matchesUsersInOrg([item.followerId, ...(item.followerIds || [])], users, orgIds);
}

function getEffectiveOrgIds(currentUser: AccessUserLike, currentRole: AccessRoleLike): string[] {
  const userOrgIds = asStringArray(currentUser.adminOrgIds);
  return userOrgIds.length > 0 ? userOrgIds : asStringArray(currentRole.orgIds);
}

const DATA_SCOPE_WEIGHT: Record<string, number> = {
  SELF: 1,
  SELF_AND_DIRECT_SUBORDINATES: 2,
  DEPT: 3,
  MULTI_ORG: 4,
  ALL: 5,
};

const FOLLOWER_DATA_SCOPE_WEIGHT: Record<string, number> = {
  SELF: 1,
  SELF_AND_DIRECT_SUBORDINATES: 2,
  DEPT: 3,
  MULTI_ORG: 4,
  ALL: 5,
};

function pickMaxScope<T extends string | null | undefined>(scopes: T[], weight: Record<string, number>): T | undefined {
  return scopes
    .filter((scope): scope is Exclude<T, null | undefined> => Boolean(scope))
    .sort((a, b) => (weight[b] || 0) - (weight[a] || 0))[0] as T | undefined;
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.flatMap(value => asStringArray(value)))];
}

function mergeAllowedPageActions(roles: AccessRoleLike[]): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const role of roles) {
    const pageActions = parseAllowedPageActions(role.allowedPageActions);
    for (const [pageAuth, actions] of Object.entries(pageActions)) {
      merged[pageAuth] = [...new Set([...(merged[pageAuth] || []), ...actions])];
    }
  }
  return merged;
}

export function getValidRoleForUser<T extends AccessRoleLike>(user: AccessUserLike, roles: T[]): T | null {
  const assignedRoleIds = new Set([
    ...asStringArray(user.roleIds),
    user.roleId,
  ].filter((id): id is string => typeof id === 'string' && id.length > 0));
  if (assignedRoleIds.size === 0) return null;

  const assignedRoles = roles.filter((role) => assignedRoleIds.has(role.id));
  if (assignedRoles.length === 0) return null;
  if (assignedRoles.length === 1) return assignedRoles[0];

  const parsedAllowedActions = assignedRoles.map(role => ({
    original: role.allowedActions,
    values: parseAllowedActions(role.allowedActions),
  }));
  // 权限的最小语义：空数组表示该角色未授予全局操作，不代表“不受限”。
  // 多角色的有效操作取各角色显式授权的并集，避免一个空数组覆盖其它角色的授权。
  const mergedAllowedActions = [...new Set(parsedAllowedActions.flatMap(({ values }) => values || []))];
  const firstMalformedActions = parsedAllowedActions.find(({ values }) => values === null)?.original;
  const ownerCustomUserIds = uniqueStrings(assignedRoles.map(role => role.ownerCustomUserIds));
  const followerCustomUserIds = uniqueStrings(assignedRoles.map(role => role.followerCustomUserIds));
  const customUserIds = uniqueStrings([
    ...assignedRoles.map(role => role.ownerCustomUserIds),
    ...assignedRoles.map(role => role.followerCustomUserIds),
    ...assignedRoles.map(role => role.customUserIds),
  ]);

  return {
    ...assignedRoles[0],
    id: Array.from(assignedRoleIds).join(','),
    permissions: uniqueStrings(assignedRoles.map(role => role.permissions)),
    dataScope: pickMaxScope(assignedRoles.map(role => role.dataScope), DATA_SCOPE_WEIGHT) || 'SELF',
    followerDataScope: pickMaxScope(assignedRoles.map(role => role.followerDataScope), FOLLOWER_DATA_SCOPE_WEIGHT) || null,
    orgIds: uniqueStrings(assignedRoles.map(role => role.orgIds)),
    ownerCustomUserIds,
    followerCustomUserIds,
    customUserIds,
    allowedActions: mergedAllowedActions.length > 0
      ? mergedAllowedActions
      : firstMalformedActions || [],
    allowedPageActions: mergeAllowedPageActions(assignedRoles),
  } as T;
}

export function hasAnyPermission(role: AccessRoleLike | null, requiredCodes: string[]): boolean {
  if (!role) return false;
  const permissions = asStringArray(role.permissions);
  return permissions.includes('ALL') || requiredCodes.some((code) => permissions.includes(code));
}

export function filterItemsByAccess<T extends AccessItemLike & { deletedAt?: unknown }>(
  items: T[],
  input: {
    currentUser: AccessUserLike;
    currentRole: AccessRoleLike | null;
    users: AccessUserLike[];
    departments?: AccessDepartmentLike[];
  },
  options: { includeDeleted?: boolean; onlyDeleted?: boolean } = {},
): T[] {
  const { currentUser, currentRole, users, departments } = input;
  if (!currentRole) return [];

  const ownerScope = currentRole.dataScope || 'SELF';
  const followerScope = currentRole.followerDataScope;
  const ownerSubjectIds = getOwnerScopeSubjectIds(currentUser, currentRole, users, departments);
  const followerSubjectIds = getFollowerScopeSubjectIds(currentUser, currentRole, users, departments);

  return items.filter((item) => {
    // 正常列表与普通详情默认隔离软删除数据；回收站只返回已删除事项。
    if (options.onlyDeleted ? !item.deletedAt : (!options.includeDeleted && item.deletedAt)) return false;
    if (matchesSharedUser(item, currentUser.id)) return true;
    if (matchesFollowerSupervisor(item, currentUser.id, users)) return true;

    let visibleByOwner = false;

    if (ownerScope === 'ALL') {
      visibleByOwner = true;
    } else if (ownerScope === 'SELF') {
      visibleByOwner = matchesOwner(item, [currentUser.id]) || matchesFollower(item, [currentUser.id]);
    } else if (ownerScope === 'SELF_AND_DIRECT_SUBORDINATES' || ownerScope === 'DEPT') {
      visibleByOwner = matchesOwner(item, ownerSubjectIds) || matchesFollower(item, [currentUser.id]);
    } else if (ownerScope === 'MULTI_ORG') {
      visibleByOwner = matchesOwnerOrg(item, users, getEffectiveOrgIds(currentUser, currentRole));
    }

    if (visibleByOwner) return true;
    if (!followerScope) return false;
    if (followerScope === 'ALL') return true;
    if (followerScope === 'DEPT') {
      return matchesOwner(item, followerSubjectIds) || matchesFollower(item, followerSubjectIds);
    }
    if (followerScope === 'MULTI_ORG') {
      return matchesFollowerOrg(item, users, getEffectiveOrgIds(currentUser, currentRole));
    }
    return matchesFollower(item, followerSubjectIds);
  });
}

type ItemAccessColumns = {
  ownerId: any;
  ownerIds: any;
  ownerName: any;
  followerId: any;
  followerIds: any;
  followerName: any;
  sharedWith: any;
  subTasks?: any;
  deletedAt: any;
};

type ItemAccessInput = {
  currentUser: AccessUserLike;
  currentRole: AccessRoleLike | null;
  users: AccessUserLike[];
  departments?: AccessDepartmentLike[];
};

function getUserNamesByIds(userIds: string[], users: AccessUserLike[]): string[] {
  const requested = new Set(userIds);
  return users
    .filter((user) => requested.has(user.id))
    .map((user: any) => String(user.name || '').trim())
    .filter(Boolean);
}

function buildPersonMatchCondition(
  idColumn: any,
  idsColumn: any,
  nameColumn: any,
  userIds: string[],
  users: AccessUserLike[],
): SQL | undefined {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return undefined;
  const userNames = getUserNamesByIds(uniqueIds, users);
  const clauses: SQL[] = [inArray(idColumn, uniqueIds)];
  if (userNames.length > 0) clauses.push(inArray(nameColumn, userNames));
  clauses.push(...uniqueIds.map((userId) => sql`JSON_CONTAINS(${idsColumn}, JSON_QUOTE(${userId}))`));
  return or(...clauses);
}

function buildSubTaskAssigneeMatchCondition(subTasksColumn: any, userIds: string[], users: AccessUserLike[]): SQL | undefined {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0 || !subTasksColumn) return undefined;
  const names = getUserNamesByIds(uniqueIds, users);
  return or(
    ...uniqueIds.map((id) => sql`JSON_SEARCH(${subTasksColumn}, 'one', ${id}, NULL, '$[*].assigneeId') IS NOT NULL`),
    ...names.map((name) => sql`JSON_SEARCH(${subTasksColumn}, 'one', ${name}, NULL, '$[*].assigneeName') IS NOT NULL`),
  );
}

/**
 * 把既有的内存数据范围策略编译为 MySQL 条件。
 * 列表查询使用此条件先下推权限，再用 filterItemsByAccess 作防御性校验，避免权限语义漂移时越权。
 */
export function buildItemAccessWhere(
  input: ItemAccessInput,
  columns: ItemAccessColumns,
  options: { includeDeleted?: boolean; onlyDeleted?: boolean } = {},
): SQL {
  const { currentUser, currentRole, users, departments } = input;
  if (!currentRole) return sql`0 = 1`;

  const ownerScope = currentRole.dataScope || 'SELF';
  const followerScope = currentRole.followerDataScope;
  const ownerSubjectIds = getOwnerScopeSubjectIds(currentUser, currentRole, users, departments);
  const followerSubjectIds = getFollowerScopeSubjectIds(currentUser, currentRole, users, departments);
  const clauses: SQL[] = [];
  const ownerMatches = (userIds: string[]) => buildPersonMatchCondition(columns.ownerId, columns.ownerIds, columns.ownerName, userIds, users);
  const ownerSubTaskMatches = (userIds: string[]) => buildSubTaskAssigneeMatchCondition(columns.subTasks, userIds, users);
  const followerMatches = (userIds: string[]) => buildPersonMatchCondition(columns.followerId, columns.followerIds, columns.followerName, userIds, users);

  // 共享字段存储为 [{ userId, userName }]，历史 TEXT 列也可由 MySQL JSON 函数读取。
  clauses.push(sql`JSON_CONTAINS(${columns.sharedWith}, JSON_OBJECT('userId', ${currentUser.id}))`);
  const directFollowerIds = users
    .filter((user) => user.supervisorId === currentUser.id && isActiveUser(user))
    .map((user) => user.id);
  const directFollowerMatch = followerMatches(directFollowerIds);
  if (directFollowerMatch) clauses.push(directFollowerMatch);

  const visibilityScope = options.onlyDeleted
    ? sql`${columns.deletedAt} IS NOT NULL`
    : options.includeDeleted ? sql`1 = 1` : sql`${columns.deletedAt} IS NULL`;
  if (ownerScope === 'ALL') {
    return visibilityScope;
  }
  if (ownerScope === 'SELF') {
    const selfOwnerMatch = ownerMatches([currentUser.id]);
    const selfFollowerMatch = followerMatches([currentUser.id]);
    if (selfOwnerMatch) clauses.push(selfOwnerMatch);
    if (selfFollowerMatch) clauses.push(selfFollowerMatch);
  } else if (ownerScope === 'SELF_AND_DIRECT_SUBORDINATES' || ownerScope === 'DEPT' || ownerScope === 'MULTI_ORG') {
    const ownerMatch = ownerMatches(ownerSubjectIds);
    if (ownerMatch) clauses.push(ownerMatch);
    const ownerSubTaskMatch = ownerSubTaskMatches(ownerSubjectIds);
    if (ownerSubTaskMatch) clauses.push(ownerSubTaskMatch);
    if (ownerScope !== 'MULTI_ORG') {
      const selfFollowerMatch = followerMatches([currentUser.id]);
      if (selfFollowerMatch) clauses.push(selfFollowerMatch);
    }
  }

  if (followerScope === 'ALL') {
    return visibilityScope;
  }
  if (followerScope === 'DEPT') {
    const ownerMatch = ownerMatches(followerSubjectIds);
    const followerMatch = followerMatches(followerSubjectIds);
    if (ownerMatch) clauses.push(ownerMatch);
    if (followerMatch) clauses.push(followerMatch);
  } else if (followerScope) {
    const followerMatch = followerMatches(followerSubjectIds);
    if (followerMatch) clauses.push(followerMatch);
  }

  const accessWhere = or(...clauses) || sql`0 = 1`;
  return and(accessWhere, visibilityScope) || sql`0 = 1`;
}

export function filterUsersByAccess<T extends AccessUserLike>(
  directoryUsers: T[],
  input: {
    currentUser: AccessUserLike;
    currentRole: AccessRoleLike | null;
    users: AccessUserLike[];
    departments?: AccessDepartmentLike[];
  },
): T[] {
  const { currentUser, currentRole, users, departments } = input;
  if (!currentRole) return [];

  const ownerScope = currentRole.dataScope || 'SELF';
  const followerScope = currentRole.followerDataScope;
  const ownerSubjectIds = new Set(getOwnerScopeSubjectIds(currentUser, currentRole, users, departments));
  const followerSubjectIds = new Set(getFollowerScopeSubjectIds(currentUser, currentRole, users, departments));
  const effectiveOrgIds = new Set(getEffectiveOrgIds(currentUser, currentRole));
  const currentDeptIds = currentUser.deptId ? new Set(getDeptAndChildDeptIds(departments, currentUser.deptId)) : new Set<string>();

  return directoryUsers.filter((candidate) => {
    if (!isActiveUser(candidate)) return false;

    if (ownerScope === 'ALL' || followerScope === 'ALL') return true;
    if (ownerSubjectIds.has(candidate.id) || followerSubjectIds.has(candidate.id)) return true;

    if ((ownerScope === 'DEPT' || followerScope === 'DEPT') && currentDeptIds.size > 0) {
      return Boolean(candidate.deptId && currentDeptIds.has(candidate.deptId));
    }

    if ((ownerScope === 'MULTI_ORG' || followerScope === 'MULTI_ORG') && effectiveOrgIds.size > 0) {
      return Boolean(candidate.orgId && effectiveOrgIds.has(candidate.orgId));
    }

    return false;
  });
}
