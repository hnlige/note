import type { DeptNode, OrgUser, Role, SupervisionItem, User } from '../types';
import {
  buildWorkbenchStatusMetrics,
  isUserWorkbenchItem,
  isWorkbenchItemMetricMatch,
  type WorkbenchMetricKey,
} from '../pages/Workbench/components/workbench-metrics';
import { filterVisibleItems, isSelfOnlyOwnerRole } from '../store/item-access';
import { mapRoleIdentityToUserRole } from '../store/role-access';
import { isItemOwnerForUser, isItemRelatedToUser } from './item-format';

/**
 * 移动端首页顶部标签：与 PC 工作台五态指标卡（待签收/已超期/未反馈/未完成/已完成）
 * 完全同一套口径实现，所有角色看到的标签集合固定一致，仅计数按角色口径分叉：
 * - 纯责任人（SELF 且无跟进范围）：本人责任人任务口径（person），按事项去重；
 * - 督办跟进人：本人作为责任人和/或跟进人的事项，事项级口径；
 * - 超级管理员 / 督办管理员 / 部门管理员等：可见范围内事项级口径。
 */
export interface MobileHomeMetricsInput {
  items: SupervisionItem[];
  currentUser: User;
  orgUsers: OrgUser[];
  roles: Role[];
  departments: DeptNode[];
}

export const MOBILE_HOME_TABS: ReadonlyArray<{ key: WorkbenchMetricKey; title: string }> = [
  { key: 'pendingOpen', title: '待签收' },
  { key: 'overdue', title: '已超期' },
  { key: 'noFeedback', title: '未反馈' },
  { key: 'incomplete', title: '未完成' },
  { key: 'completed', title: '已完成' },
];

const TAB_TITLE_MAP = new Map(MOBILE_HOME_TABS.map(tab => [tab.key, tab.title]));

export function getMobileHomeTabTitle(key: WorkbenchMetricKey): string {
  return TAB_TITLE_MAP.get(key) || key;
}

interface ResolvedScope {
  mode: 'person' | 'item';
  scopedItems: SupervisionItem[];
}

/** 与 PC 工作台 MetricCards.getMetrics 的分叉逻辑保持一致 */
function resolveMobileHomeScope(input: MobileHomeMetricsInput): ResolvedScope {
  const { items, currentUser, orgUsers, roles, departments } = input;
  const effectiveUser = orgUsers.find(user => user.id === currentUser.id) || currentUser;
  const mode = isSelfOnlyOwnerRole(effectiveUser, roles) ? 'person' : 'item';
  const visibleItems = filterVisibleItems({ items, currentUser, orgUsers, roles, departments });

  const scopedItems =
    mode === 'person'
      ? visibleItems.filter(item => isItemOwnerForUser(item, currentUser))
      : mapRoleIdentityToUserRole(effectiveUser) === 'FOLLOWER'
        ? visibleItems.filter(item => isItemRelatedToUser(item, currentUser))
        : visibleItems;

  return { mode, scopedItems };
}

/** 首页顶部五个标签的计数（顺序固定为 待签收/已超期/未反馈/未完成/已完成） */
export function buildMobileHomeTabs(
  input: MobileHomeMetricsInput,
): Array<{ key: WorkbenchMetricKey; title: string; value: number }> {
  const { mode, scopedItems } = resolveMobileHomeScope(input);
  const metrics = buildWorkbenchStatusMetrics(scopedItems, mode, input.currentUser);
  return MOBILE_HOME_TABS.map(({ key, title }) => ({
    key,
    title,
    value: metrics.find(metric => metric.key === key)?.value ?? 0,
  }));
}

/**
 * 首页标签下钻列表：与对应标签的计数完全同口径，
 * 保证「首页标签数字 N」=== 下钻《待办中心》展示条数 N。
 */
export function filterItemsByMobileTab(
  key: WorkbenchMetricKey,
  input: MobileHomeMetricsInput,
): SupervisionItem[] {
  const { mode, scopedItems } = resolveMobileHomeScope(input);
  return scopedItems.filter(item =>
    mode === 'person'
      ? isUserWorkbenchItem(key, item, input.currentUser)
      : isWorkbenchItemMetricMatch(key, item),
  );
}
