import { getSystemSettingsPath } from '../../components/Layout/header-settings';
import { Role, User } from '../../types';

type RoleIdentity = Pick<User, 'roleId' | 'roleIds'>;

export function getProfileSystemSettingsState(user: RoleIdentity, roles: readonly Role[]) {
  const path = getSystemSettingsPath(user, roles);

  return {
    path,
    enabled: path !== '/profile',
  };
}
