import { Role, User } from '../types';
import { getRolesByUser } from './role-access';

type RoleIdentity = Pick<User, 'roleId' | 'roleIds'>;

export function canAccessMyItems(user: RoleIdentity, roles: readonly Role[]): boolean {
  const assignedRoles = getRolesByUser(user, roles);
  if (assignedRoles.length === 0) return false;

  return assignedRoles.some((role) => {
    const hasMenuAccess = (role.authCodes || []).includes('ALL') || (role.authCodes || []).includes('MENU_MY_ITEMS');
    if (!hasMenuAccess) return false;

    const hasScope = ['SELF', 'DEPT', 'MULTI_ORG', 'ALL'].includes(role.dataScope)
      || ['SELF', 'DEPT', 'MULTI_ORG', 'ALL'].includes(role.followerDataScope || '');
    if (!hasScope) return false;

    if (!role.allowedActions || role.allowedActions.length === 0) return true;
    return role.allowedActions.some((action) =>
      ['READ', 'SEARCH', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM', 'APPLY_COMPLETE_ITEM', 'URGE_ITEM', 'EDIT_ITEM'].includes(action),
    );
  });
}
