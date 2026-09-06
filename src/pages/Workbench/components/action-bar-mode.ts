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
  // 仅真正拥有全部权限的超管（ALL）进入「全量督办事项」视图。
  // 督办跟进人(r2)等角色虽被授予回收站菜单码(MENU_RECYCLE_BIN)，但具备签收/反馈能力，
  // 不应因此被误判为 admin 而丢失「我的待办任务」视图与责任人操作按钮（见 ActionBar.tsx）。
  // 故先判定超管，再判定责任人能力，最后才回退到回收站/催办菜单权限对应的视图。
  if (canAccessByAuthCodes(user, roles, ['ALL'])) {
    return 'admin';
  }

  const { canSignWorkbench, canFeedbackWorkbench } = getWorkbenchOwnerActionControls(user, roles);
  if (canSignWorkbench || canFeedbackWorkbench) {
    return 'owner';
  }

  if (canAccessByAuthCodes(user, roles, ['MENU_RECYCLE_BIN'])) {
    return 'admin';
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
