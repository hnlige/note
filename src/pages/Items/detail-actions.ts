import { AllowedAction, Role } from '../../types';
import { canUsePageAction } from '../../store/role-access';

type DetailPageUser = { roleId?: string; roleIds?: string[] };

/**
 * 详情页动作鉴权：判定指定用户（按 roleId/roleIds 解析角色）在给定页面（pageAuth）下
 * 是否可使用某个动作。需同时满足：
 *  - 该动作在权限目录中被该页面支持（防止越权调用非本页动作，如详情页误用 DELETE_ITEM）；
 *  - 角色已授予该动作（按页面 allowedPageActions 或全局 allowedActions）。
 */
export function canUseDetailPageAction(
  user: DetailPageUser,
  roles: readonly Role[],
  pageAuth: string,
  action: string,
): boolean {
  return canUsePageAction(user, roles, pageAuth, action as AllowedAction);
}
