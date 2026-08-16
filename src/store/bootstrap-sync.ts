import { Role, User } from '../types';
import { canAccessByAuthCodes } from './role-access';

type RoleIdentity = Pick<User, 'roleId' | 'roleIds'>;

export function shouldSyncOrgUsers(user: RoleIdentity, roles: readonly Role[]): boolean {
  return canAccessByAuthCodes(user, roles, ['MENU_ORG', 'MENU_ITEMS', 'MENU_WORKBENCH']);
}

export function shouldSyncRoles(user: RoleIdentity, roles: readonly Role[]): boolean {
  return canAccessByAuthCodes(user, roles, ['MENU_ROLES']);
}
