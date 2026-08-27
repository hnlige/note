import type { Role, User } from '../types';
import { getRolesByUser } from '../store/role-access';

/**
 * 首页「最近动态」对其隐藏的角色：
 * 超级管理员、督办责任人（内置名「责任人」）、督办跟进人、督办管理员、部门管理员。
 * 按内置角色 ID 与角色名双重匹配，线上角色即使被改名也能命中。
 */
const HIDDEN_ROLE_IDS = new Set(['r1', 'r2', 'r3', 'r4dtsn6m', 'r6']);
const HIDDEN_ROLE_NAMES = new Set([
  '超级管理员',
  '督办跟进人',
  '部门管理员',
  '督办管理员',
  '责任人',
  '督办责任人',
]);

/**
 * 判断首页「最近动态」模块是否对该用户可见。
 * 用户持有的任一命中角色即隐藏；其余角色（如组织管理员）保持可见。
 */
export function shouldShowRecentActivity(
  user: Pick<User, 'roleId' | 'roleIds'> | null | undefined,
  roles: readonly Role[],
): boolean {
  if (!user) return true;
  const assignedRoles = getRolesByUser(user, roles);
  return !assignedRoles.some(
    (role) => HIDDEN_ROLE_IDS.has(role.id) || HIDDEN_ROLE_NAMES.has(role.name.trim()),
  );
}
