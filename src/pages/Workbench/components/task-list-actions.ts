import { Role, User, UserRole } from '../../../types';
import { canUsePageAction } from '../../../store/role-access';

type WorkbenchRowUser = Pick<User, 'roleId' | 'roleIds'> & {
  role?: string;
};

/**
 * 行内签收/反馈按钮可见性。
 * 注意：roleKind 必须由调用方按「当前用户在此事项中的身份」得出（责任人→OWNER），
 * 不能依赖用户全局分配的 roleId——双重身份用户（如同时是跟进人 r2 与责任人）若按其
 * 全局 roleId 映射，会因 r2 优先级被错判为 FOLLOWER，导致责任人视图下丢失签收按钮。
 */
export function getWorkbenchRowActionVisibility(
  roleKind: UserRole,
  user: WorkbenchRowUser,
  roles: readonly Role[],
  effectiveStatus: string,
): { canSign: boolean; canFeedback: boolean } {
  const canUseSignAction = canUsePageAction(user, roles, 'MENU_WORKBENCH', 'SIGN_ITEM');
  const canUseFeedbackAction = canUsePageAction(user, roles, 'MENU_WORKBENCH', 'FEEDBACK_ITEM');

  return {
    canSign: roleKind === 'OWNER'
      && effectiveStatus === 'PENDING'
      && canUseSignAction,
    // 反馈仅在责任人「已签收且未超时」时可见：
    // - 签收前（子任务 PENDING）隐藏；
    // - 已超时（子任务 OVERDUE）需先申请延期，不能直接反馈，也隐藏。
    canFeedback: roleKind === 'OWNER'
      && canUseFeedbackAction
      && effectiveStatus !== 'PENDING'
      && effectiveStatus !== 'OVERDUE',
  };
}
