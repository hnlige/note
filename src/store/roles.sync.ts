import type { AllowedAction, AllowedPageActions, DataScope, FollowerDataScope, Role } from '../types';

export interface RoleIdentity {
  id: string;
  name: string;
}

export interface BuiltInRoleSnapshot extends RoleIdentity {
  authCodes?: string[];
  dataScope?: string;
  followerDataScope?: string;
  allowedActions?: string[];
}

export interface RemoteRoleSnapshot extends RoleIdentity {
  permissions?: string[];
  authCodes?: string[];
  dataScope?: string;
  followerDataScope?: string | null;
  allowedActions?: string[];
  allowedPageActions?: unknown;
  orgIds?: unknown;
  customUserIds?: unknown;
  ownerCustomUserIds?: unknown;
  followerCustomUserIds?: unknown;
}

export function getMissingRolesToCreate<T extends RoleIdentity>(
  localRoles: T[],
  remoteRoles: RoleIdentity[],
): T[] {
  const remoteRoleIds = new Set(remoteRoles.map(role => role.id));
  return localRoles.filter(role => !remoteRoleIds.has(role.id));
}

function normalizeList(values: string[] | undefined): string[] {
  return [...new Set(values || [])].sort();
}

function sameList(left: string[] | undefined, right: string[] | undefined): boolean {
  return JSON.stringify(normalizeList(left)) === JSON.stringify(normalizeList(right));
}

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

function normalizeAllowedPageActions(value: unknown): AllowedPageActions {
  if (typeof value === 'string') {
    try {
      return normalizeAllowedPageActions(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([pageAuth, actions]) => [
        pageAuth,
        Array.isArray(actions) ? normalizeStringArray(actions) as AllowedAction[] : [],
      ] as const)
      .filter(([, actions]) => actions.length > 0),
  ) as AllowedPageActions;
}

export function mapRemoteRoleToRole(
  remoteRole: RemoteRoleSnapshot,
  builtInRole?: Partial<Role>,
): Role {
  const ownerCustomUserIds = normalizeStringArray(remoteRole.ownerCustomUserIds);
  const followerCustomUserIds = normalizeStringArray(remoteRole.followerCustomUserIds);
  const legacyCustomUserIds = normalizeStringArray(remoteRole.customUserIds);
  const mergedCustomUserIds = [...new Set([...ownerCustomUserIds, ...followerCustomUserIds, ...legacyCustomUserIds])];
  const permissions = normalizeStringArray(remoteRole.permissions);
  const authCodes = normalizeStringArray(remoteRole.authCodes);
  const hasExplicitAllowedActions = remoteRole.allowedActions !== undefined && remoteRole.allowedActions !== null;

  return {
    id: remoteRole.id,
    name: remoteRole.name,
    authCodes: permissions.length > 0 ? permissions : (authCodes.length > 0 ? authCodes : builtInRole?.authCodes || []),
    dataScope: (remoteRole.dataScope || builtInRole?.dataScope || 'SELF') as DataScope,
    followerDataScope: (remoteRole.followerDataScope ?? builtInRole?.followerDataScope ?? undefined) as FollowerDataScope | undefined,
    allowedActions: hasExplicitAllowedActions
      ? normalizeStringArray(remoteRole.allowedActions) as AllowedAction[]
      : builtInRole?.allowedActions,
    allowedPageActions: normalizeAllowedPageActions(remoteRole.allowedPageActions),
    orgIds: normalizeStringArray(remoteRole.orgIds),
    ownerCustomUserIds,
    followerCustomUserIds,
    customUserIds: mergedCustomUserIds,
  };
}

export function getBuiltInRoleUpdates(
  localRoles: BuiltInRoleSnapshot[],
  remoteRoles: RemoteRoleSnapshot[],
): Array<{
  id: string;
  authCodes: string[];
  dataScope?: string;
  followerDataScope?: string;
  allowedActions?: string[];
}> {
  return localRoles.flatMap((localRole) => {
    const remoteRole = remoteRoles.find((role) => role.id === localRole.id);
    if (!remoteRole) return [];

    const needsUpdate =
      (localRole.dataScope || undefined) !== (remoteRole.dataScope || undefined) ||
      (localRole.followerDataScope || undefined) !== (remoteRole.followerDataScope || undefined) ||
      !sameList(localRole.allowedActions, remoteRole.allowedActions);

    if (!needsUpdate) return [];

    return [{
      id: localRole.id,
      authCodes: localRole.authCodes || [],
      dataScope: localRole.dataScope,
      followerDataScope: localRole.followerDataScope,
      allowedActions: localRole.allowedActions,
    }];
  });
}
