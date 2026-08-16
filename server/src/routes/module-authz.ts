import { hasPageAction, parseAllowedActions, parseAllowedPageActions } from './page-actions';

export { hasPageAction };

interface RoleLike {
  permissions?: unknown[];
  authCodes?: unknown;
  allowedActions?: unknown;
  allowedPageActions?: unknown;
}

interface UserIdentityLike {
  id: string;
  name?: string | null;
  username?: string | null;
}

interface MessageIdentityLike {
  receiverId?: string | null;
  receiverName?: string | null;
  senderId?: string | null;
  senderName?: string | null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  // MariaDB TEXT 列存储 JSON 字符串时，Drizzle JSON 类型不会自动解析
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return asStringArray(parsed); } catch { /* ignore */ }
  }
  return [];
}

function hasAnyPermission(role: RoleLike | null | undefined, required: string[]): boolean {
  const permissions = asStringArray(role?.permissions);
  return permissions.includes('ALL') || required.some((code) => permissions.includes(code));
}

function hasAnyAction(role: RoleLike | null | undefined, required: string[]): boolean {
  const permissions = asStringArray(role?.permissions);
  if (permissions.includes('ALL')) return true;

  const allowedActions = parseAllowedActions(role?.allowedActions);
  if (allowedActions === null) return false;
  if (allowedActions.length === 0) return false;

  return required.some((action) => allowedActions.includes(action));
}

function hasPermissionAndAction(
  role: RoleLike | null | undefined,
  requiredPermissions: string[],
  requiredActions: string[],
): boolean {
  return hasAnyPermission(role, requiredPermissions) && hasAnyAction(role, requiredActions);
}

function findUserById(userId: string | null | undefined, users: UserIdentityLike[]): UserIdentityLike | null {
  if (!userId) return null;
  return users.find((user) => user.id === userId) || null;
}

function findUserByLabel(label: string | null | undefined, users: UserIdentityLike[]): UserIdentityLike | null {
  if (!label) return null;
  return users.find((user) => user.name === label || user.username === label) || null;
}

export function canManageRoles(role: RoleLike | null | undefined): boolean {
  return hasAnyPermission(role, ['ALL'])
    || (hasAnyPermission(role, ['MENU_ROLES']) && hasPageAction(role, 'MENU_ROLES', 'EDIT_SYSTEM'));
}

export function canViewRoles(role: RoleLike | null | undefined): boolean {
  // 拥有 MENU_ROLES 或 ALL 者可查看角色列表（只读）
  return hasAnyPermission(role, ['MENU_ROLES', 'ALL']);
}

export function hasGlobalModuleAccess(role: RoleLike | null | undefined): boolean {
  return hasAnyPermission(role, ['ALL']);
}

export function canManageUsers(role: RoleLike | null | undefined): boolean {
  return hasPermissionAndAction(role, ['MENU_ORG', 'MENU_SYSTEM'], ['EDIT_SYSTEM']);
}

export function canReadUsers(role: RoleLike | null | undefined): boolean {
  return hasAnyPermission(role, ['MENU_ORG', 'MENU_SYSTEM', 'MENU_ITEMS', 'MENU_WORKBENCH']);
}

export function canReadDepartments(role: RoleLike | null | undefined): boolean {
  return hasAnyPermission(role, ['MENU_WORKBENCH', 'MENU_MY_ITEMS', 'MENU_ITEMS', 'MENU_ORG', 'MENU_SYSTEM']);
}

export function canManageDepartments(role: RoleLike | null | undefined): boolean {
  return hasPermissionAndAction(role, ['MENU_ORG', 'MENU_SYSTEM'], ['EDIT_SYSTEM']);
}

export function canReadTemplates(role: RoleLike | null | undefined): boolean {
  return hasAnyPermission(role, ['MENU_TEMPLATES', 'MENU_RULES', 'MENU_SYSTEM']);
}

export function canManageTemplates(role: RoleLike | null | undefined): boolean {
  return canReadTemplates(role) && hasAnyAction(role, ['EDIT_SYSTEM']);
}

export function canReadDictionaries(role: RoleLike | null | undefined): boolean {
  return hasAnyPermission(role, ['MENU_SYSTEM']);
}

export function canManageDictionaries(role: RoleLike | null | undefined): boolean {
  return canReadDictionaries(role) && hasAnyAction(role, ['EDIT_SYSTEM']);
}

export function canReadAudit(role: RoleLike | null | undefined): boolean {
  return hasAnyPermission(role, ['MENU_AUDIT']);
}

export function canManageAudit(role: RoleLike | null | undefined): boolean {
  return canReadAudit(role) && hasAnyAction(role, ['APPROVE_ITEM', 'REJECT_ITEM', 'EDIT_SYSTEM']);
}

export function canReadAsyncTasks(role: RoleLike | null | undefined): boolean {
  return hasAnyPermission(role, ['MENU_TASKS']);
}

export function canManageAsyncTasks(role: RoleLike | null | undefined): boolean {
  return canReadAsyncTasks(role) && hasAnyAction(role, ['EDIT_SYSTEM']);
}

export function canReadLights(role: RoleLike | null | undefined): boolean {
  return hasAnyPermission(role, ['MENU_LIGHTS']);
}

export function canManageLights(role: RoleLike | null | undefined): boolean {
  return canReadLights(role) && hasAnyAction(role, ['EDIT_SYSTEM']);
}

export function canReadGlobalRules(role: RoleLike | null | undefined): boolean {
  return hasAnyPermission(role, ['MENU_RULES', 'MENU_SYSTEM', 'MENU_WECOM']);
}

export function canManageGlobalRules(role: RoleLike | null | undefined): boolean {
  return canReadGlobalRules(role) && hasAnyAction(role, ['EDIT_SYSTEM']);
}

export function canReadLogs(role: RoleLike | null | undefined): boolean {
  return hasAnyPermission(role, ['MENU_LOGS']);
}

export function canManageLogs(role: RoleLike | null | undefined): boolean {
  return canReadLogs(role) && hasPageAction(role, 'MENU_LOGS', 'EDIT_SYSTEM');
}

const NON_MUTATING_ACTIONS = new Set(['READ', 'SEARCH', 'EXPORT']);

export function canWriteOperationLog(role: RoleLike | null | undefined): boolean {
  if (!role) return false;
  if (canManageLogs(role)) return true;

  const allowedActions = parseAllowedActions(role.allowedActions);
  if (allowedActions === null) return false;
  if (allowedActions.some(action => !NON_MUTATING_ACTIONS.has(action))) return true;

  const allowedPageActions = parseAllowedPageActions(role.allowedPageActions);
  if (Object.values(allowedPageActions).some(actions => actions.some(action => !NON_MUTATING_ACTIONS.has(action)))) {
    return true;
  }

  return false;
}

export function canReadActivities(role: RoleLike | null | undefined): boolean {
  return hasAnyPermission(role, ['MENU_WORKBENCH']);
}

export function canManageActivities(role: RoleLike | null | undefined): boolean {
  return hasAnyPermission(role, ['ALL']);
}

export function canReadMessages(role: RoleLike | null | undefined): boolean {
  return hasAnyPermission(role, ['MENU_MESSAGES']);
}

export function canManageMessages(role: RoleLike | null | undefined): boolean {
  return canReadMessages(role);
}

export function canReadUrges(role: RoleLike | null | undefined): boolean {
  return hasAnyPermission(role, ['MENU_MONITORING']);
}

export function canManageUrges(role: RoleLike | null | undefined): boolean {
  return canReadUrges(role) && hasAnyAction(role, ['URGE_ITEM', 'EDIT_SYSTEM']);
}

export function canReplyUrge(role: RoleLike | null | undefined): boolean {
  return hasAnyPermission(role, ['MENU_MESSAGES', 'MENU_MONITORING']);
}

export function getMessageTargetIdentities(
  input: {
    receiverId?: string | null;
    receiverName?: string | null;
    senderId?: string | null;
    senderName?: string | null;
  },
  users: UserIdentityLike[],
): {
  receiverId?: string | null;
  receiverName?: string | null;
  senderId?: string | null;
  senderName?: string | null;
} {
  const receiver = input.receiverId
    ? findUserById(input.receiverId, users)
    : findUserByLabel(input.receiverName, users);
  const sender = input.senderId
    ? findUserById(input.senderId, users)
    : findUserByLabel(input.senderName, users);

  return {
    receiverId: receiver?.id || input.receiverId || null,
    receiverName: receiver?.name || input.receiverName || null,
    senderId: sender?.id || input.senderId || null,
    senderName: sender?.name || input.senderName || null,
  };
}

export function isMessageVisibleToUser(message: MessageIdentityLike, currentUser: { id: string; name?: string | null }): boolean {
  if (!message.receiverId && !message.receiverName) return true;
  if (message.receiverId) return message.receiverId === currentUser.id;
  return message.receiverName === currentUser.name;
}

export function isUrgeVisibleToUser(record: MessageIdentityLike, currentUser: { id: string; name?: string | null }): boolean {
  if (record.receiverId) return record.receiverId === currentUser.id || record.senderId === currentUser.id;
  return record.receiverName === currentUser.name || record.senderName === currentUser.name;
}
