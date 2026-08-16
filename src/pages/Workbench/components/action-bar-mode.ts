import { Role, User, UserRole } from '../../../types';
import { canAccessByAuthCodes, canUseAllowedAction, canUsePageAction } from '../../../store/role-access';

type RoleIdentity = Pick<User, 'roleId' | 'roleIds'> & {
  role?: UserRole;
};

export type ActionBarMode = 'admin' | 'owner' | 'follower' | 'none';

function getWorkbenchOwnerActionControls(user: RoleIdentity, roles: readonly Role[]) {
  return {
    canSignWorkbench: canUsePageAction(user, roles, 'MENU_WORKBENCH', 'SIGN_ITEM'),
    canFeedbackWorkbench: canUsePageAction(user, roles, 'MENU_WORKBENCH', 'FEEDBACK_ITEM'),
  };
}

export function getActionBarMode(user: RoleIdentity, roles: readonly Role[]): ActionBarMode {
  if (canAccessByAuthCodes(user, roles, ['MENU_RECYCLE_BIN'])) {
    return 'admin';
  }

  const { canSignWorkbench, canFeedbackWorkbench } = getWorkbenchOwnerActionControls(user, roles);
  if (canSignWorkbench || canFeedbackWorkbench) {
    return 'owner';
  }

  if (canUseAllowedAction(user, roles, 'URGE_ITEM')) {
    return 'follower';
  }

  return 'none';
}

export function getActionBarControls(user: RoleIdentity, roles: readonly Role[]) {
  const ownerActions = getWorkbenchOwnerActionControls(user, roles);
  return {
    mode: getActionBarMode(user, roles),
    ...ownerActions,
    canCreateItem: canUsePageAction(user, roles, 'MENU_WORKBENCH', 'CREATE_ITEM'),
    canDownloadTemplate: canUsePageAction(user, roles, 'MENU_WORKBENCH', 'DOWNLOAD_TEMPLATE'),
    canBatchImport: canUsePageAction(user, roles, 'MENU_WORKBENCH', 'BATCH_IMPORT'),
    canExportWorkbench: canUsePageAction(user, roles, 'MENU_WORKBENCH', 'EXPORT'),
  };
}
