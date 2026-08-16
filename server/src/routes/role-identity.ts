type RoleIdentityLike = {
  role?: string | null;
  roleId?: string | null;
  roleIds?: unknown;
};

type NamedRoleLike = {
  id: string;
  name?: string | null;
};

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

export function getAssignedRoleIds(user: RoleIdentityLike): string[] {
  return [...new Set([
    user.roleId,
    ...parseStringArray(user.roleIds),
  ].filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

export function getPrimaryAssignedRole<T extends NamedRoleLike>(user: RoleIdentityLike, roles: T[]): T | null {
  const primaryRoleId = typeof user.roleId === 'string' && user.roleId.length > 0 ? user.roleId : '';
  if (primaryRoleId) {
    const matchedRole = roles.find((role) => role.id === primaryRoleId);
    if (matchedRole) return matchedRole;
  }

  for (const roleId of parseStringArray(user.roleIds)) {
    const matchedRole = roles.find((role) => role.id === roleId);
    if (matchedRole) return matchedRole;
  }

  return null;
}

export function resolveDisplayRoleName(user: RoleIdentityLike, roles: NamedRoleLike[]): string {
  return getPrimaryAssignedRole(user, roles)?.name || user.role || '';
}

export function isFollowerRoleIdentity(user: RoleIdentityLike): boolean {
  const assignedRoleIds = getAssignedRoleIds(user);
  return assignedRoleIds.includes('r2') || user.role === '督办专员' || user.role === 'FOLLOWER';
}
