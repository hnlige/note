import type { Role, User } from '../../types';
import { canAccessByAuthCodes } from '../../store/role-access';

type RoleIdentity = Pick<User, 'roleId' | 'roleIds'>;

export function getGlobalRulesNavigation(user: RoleIdentity, roles: readonly Role[]) {
  const canAccessTemplates = canAccessByAuthCodes(user, roles, ['MENU_TEMPLATES']);

  if (canAccessTemplates) {
    return {
      backPath: '/templates',
      backLabel: '返回模板管理',
      successPath: '/templates',
    };
  }

  return {
    backPath: '/templates/rules',
    backLabel: '返回系统设置',
    successPath: '/templates/rules',
  };
}
