import { canAccessByAuthCodes, canUseAllowedAction } from '../../../store/role-access';
import { AllowedAction, AllowedPageActions, Role, User } from '../../../types';
import { getAllConfigurableActionCodes, pageSupportsAction, PERMISSION_TREE } from './permission-catalog';

const CONFIGURABLE_ALLOWED_ACTIONS = new Set<AllowedAction>(getAllConfigurableActionCodes());

export const toggleAllowedAction = (
  allowedActions: AllowedAction[] | undefined,
  action: AllowedAction,
): AllowedAction[] => {
  const current = allowedActions || [];
  return current.includes(action)
    ? current.filter((item) => item !== action)
    : [...current, action];
};

export const canToggleAllowedAction = (action: AllowedAction): boolean =>
  CONFIGURABLE_ALLOWED_ACTIONS.has(action);

export const togglePageAllowedAction = (
  allowedPageActions: AllowedPageActions | undefined,
  pageAuth: string,
  action: AllowedAction,
): AllowedPageActions => {
  const current = allowedPageActions || {};
  const currentActions = current[pageAuth] || [];
  const nextActions = currentActions.includes(action)
    ? currentActions.filter((item) => item !== action)
    : [...currentActions, action];

  const next = { ...current };
  if (nextActions.length > 0) {
    next[pageAuth] = nextActions;
  } else {
    delete next[pageAuth];
  }
  return next;
};

export const isPageActionChecked = (
  role: Pick<Role, 'authCodes' | 'allowedActions' | 'allowedPageActions'> | undefined,
  pageAuth: string,
  action: AllowedAction,
): boolean => {
  if (!role || !pageSupportsAction(pageAuth, action)) return false;
  // 页面级配置优先：一旦角色对某个页面显式配置了按钮，就以该配置为准，
  // 这样内置管理员也能被独立勾选/取消，且取消不会被全局 ALL 覆盖。
  const pageActions = role.allowedPageActions?.[pageAuth];
  if (Array.isArray(pageActions)) return pageActions.includes(action);
  // 未配置页面级时，ALL 视为全量勾选；否则回退到全局 allowedActions。
  if (role.authCodes?.includes('ALL')) return true;
  // 注意：空/未设置全局操作权限表示“无按钮授权”，不再等同于“全部允许”。
  if (!role.allowedActions || role.allowedActions.length === 0) return false;
  return role.allowedActions.includes(action);
};

export const getEditableAuthCodes = (
  authCodes: string[] | undefined,
  allPermissionCodes: string[],
): string[] => {
  const current = authCodes || [];
  return current.includes('ALL') ? [...allPermissionCodes] : current.filter((code) => code !== 'ALL');
};

export const isPermissionChecked = (
  authCodes: string[] | undefined,
  permissionCode: string,
): boolean => {
  const current = authCodes || [];
  return current.includes('ALL') || current.includes(permissionCode);
};

export const togglePermissionCode = (
  authCodes: string[] | undefined,
  permissionCode: string,
  allPermissionCodes: string[],
): string[] => {
  const editableCodes = getEditableAuthCodes(authCodes, allPermissionCodes);
  return editableCodes.includes(permissionCode)
    ? editableCodes.filter((code) => code !== permissionCode)
    : [...editableCodes, permissionCode];
};

export const buildNewRole = (id: string, name: string): Role => ({
  id,
  name,
  authCodes: ['MENU_WORKBENCH'],
  dataScope: 'SELF',
  followerDataScope: undefined,
  orgIds: [],
  customUserIds: [],
  ownerCustomUserIds: [],
  followerCustomUserIds: [],
  allowedActions: ['READ', 'SEARCH'],
  allowedPageActions: {
    MENU_WORKBENCH: ['READ', 'SEARCH'],
  },
});

export function canManageRolePermissions(
  user: Pick<User, 'role' | 'roleId' | 'roleIds'>,
  roles: readonly Role[],
): boolean {
  return (
    canAccessByAuthCodes(user, roles, ['MENU_ROLES'])
    || canUseAllowedAction(user, roles, 'EDIT_SYSTEM')
    || user.role === 'ADMIN'
  );
}

/**
 * 将角色的“全局操作权限(allowedActions)”按权限树铺开为“页面级按钮权限(allowedPageActions)”。
 *
 * 旧数据只配置了全局 allowedActions、没有 allowedPageActions，导致页面按钮勾选框
 * 只能读全局判断、取消不掉。这里在加载角色时把有效授权物化为显式的页面级列表，
 * 使每个按钮都能被独立勾选/取消并正确持久化。
 *
 * - 已显式配置页面级（含空数组）：原样保留，优先级最高。
 * - authCodes 含 ALL：该页面所有支持的按钮均授权。
 * - 否则：取该页面支持且全局 allowedActions 包含的按钮。
 * - 全局为空/未设置：不产出任何页面按钮（即“无授权”，不再等同于全部允许）。
 */
export function materializeAllowedPageActions(role: Pick<Role, 'authCodes' | 'allowedActions' | 'allowedPageActions'> | undefined): AllowedPageActions {
  const result: Record<string, AllowedAction[]> = {};
  if (!role) return result;
  for (const group of PERMISSION_TREE) {
    for (const page of group.children) {
      const existing = role.allowedPageActions?.[page.auth];
      if (Array.isArray(existing)) {
        result[page.auth] = existing;
        continue;
      }
      if (role.authCodes?.includes('ALL')) {
        result[page.auth] = page.actions.map((action) => action.value);
        continue;
      }
      if (role.allowedActions && role.allowedActions.length > 0) {
        const supported = page.actions
          .map((action) => action.value)
          .filter((value) => role.allowedActions!.includes(value));
        if (supported.length > 0) result[page.auth] = supported;
      }
    }
  }
  return result;
}
