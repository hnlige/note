import { Role, User } from '../../types';
import { canAccessByAuthCodes } from '../../store/role-access';

type RoleIdentity = Pick<User, 'roleId' | 'roleIds'>;

const SYSTEM_SETTINGS_DESTINATIONS = [
  { authCodes: ['MENU_SYSTEM'], path: '/settings/config' },
  { authCodes: ['MENU_ORG'], path: '/settings/org' },
  { authCodes: ['MENU_ROLES'], path: '/settings/role-permissions' },
  { authCodes: ['MENU_RULES'], path: '/templates/rules' },
  { authCodes: ['MENU_WECOM'], path: '/settings/wecom' },
  { authCodes: ['MENU_LOGS'], path: '/settings/logs' },
  { authCodes: ['MENU_TASKS'], path: '/system/tasks' },
] as const;

export function getSystemSettingsPath(user: RoleIdentity, roles: readonly Role[]): string {
  return SYSTEM_SETTINGS_DESTINATIONS.find(destination =>
    canAccessByAuthCodes(user, roles, [...destination.authCodes])
  )?.path || '/profile';
}
