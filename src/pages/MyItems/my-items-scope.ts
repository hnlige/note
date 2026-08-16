import { getEffectiveItemStatus, getEffectiveStatusForUserIdentity, isItemFollowerForUser, isItemOwnerForUser } from '../../lib/item-format';
import { ItemStatus, SupervisionItem, User } from '../../types';

export type MyItemsRoleTabKey = 'todo' | 'owner' | 'follower';
export type MyItemsStatusTabKey = 'all' | 'PENDING' | 'EXECUTING' | 'OVERDUE' | 'DELAYED' | 'COMPLETED';

export type MyItemsStatusCounts = Record<MyItemsStatusTabKey, number>;

export type MyItemsRoleType = 'ADMIN' | 'OWNER' | 'FOLLOWER';

/**
 * 按当前用户的角色类型决定《我的督办》顶层页签的可见性：
 * - ADMIN（超级管理员 / 督办管理员）：可见「我的待办 + 我负责的督办 + 我跟进的督办」
 * - OWNER（督办责任人）：可见「我的待办 + 我负责的督办」（无跟进视角）
 * - FOLLOWER（督办跟进人）：可见「我的待办 + 我跟进的督办」（无负责视角）
 * 语义对应需求：我负责的 = 作为责任人；我跟进的 = 作为跟进人。
 */
export function getVisibleMyItemsRoleTabs(roleType: MyItemsRoleType): MyItemsRoleTabKey[] {
  if (roleType === 'ADMIN') return ['todo', 'owner', 'follower'];
  if (roleType === 'OWNER') return ['todo', 'owner'];
  return ['todo', 'follower'];
}

export interface MyItemsScope {
  ownedItems: SupervisionItem[];
  followedItems: SupervisionItem[];
  todoItems: SupervisionItem[];
  ownerStatusCounts: MyItemsStatusCounts;
  followerStatusCounts: MyItemsStatusCounts;
  todoStatusCounts: Partial<Record<ItemStatus, number>>;
}

type MyItemsUser = Pick<User, 'id' | 'name' | 'username'>;

const TODO_EXCLUDED_STATUSES: ItemStatus[] = ['COMPLETED', 'ARCHIVED', 'DISABLED', 'DELETED'];

function emptyStatusCounts(): MyItemsStatusCounts {
  return {
    all: 0,
    PENDING: 0,
    EXECUTING: 0,
    OVERDUE: 0,
    DELAYED: 0,
    COMPLETED: 0,
  };
}

function isVisibleMyItem(item: SupervisionItem): boolean {
  return item.status !== 'DELETED';
}

function uniqueItems(items: SupervisionItem[]): SupervisionItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function getMyRoleScopedStatus(
  item: SupervisionItem,
  user: MyItemsUser,
  role: MyItemsRoleTabKey,
): ItemStatus {
  // 我的待办：优先按责任人视角取有效状态，否则按跟进人/事项整体视角
  if (role === 'todo') {
    return isItemOwnerForUser(item, user)
      ? getEffectiveStatusForUserIdentity(item, user)
      : getEffectiveItemStatus(item);
  }
  return role === 'owner'
    ? getEffectiveStatusForUserIdentity(item, user)
    : getEffectiveItemStatus(item);
}

function getTodoStatus(item: SupervisionItem, user: MyItemsUser): ItemStatus {
  const ownerStatus = isItemOwnerForUser(item, user) ? getMyRoleScopedStatus(item, user, 'owner') : undefined;
  const followerStatus = isItemFollowerForUser(item, user) ? getMyRoleScopedStatus(item, user, 'follower') : undefined;
  return [ownerStatus, followerStatus].find(status => status && !TODO_EXCLUDED_STATUSES.includes(status)) || ownerStatus || followerStatus || getEffectiveItemStatus(item);
}

function buildStatusCounts(items: SupervisionItem[], user: MyItemsUser, role: MyItemsRoleTabKey): MyItemsStatusCounts {
  const counts = emptyStatusCounts();
  counts.all = items.length;

  items.forEach((item) => {
    const status = getMyRoleScopedStatus(item, user, role);
    if (status === 'PENDING' || status === 'EXECUTING' || status === 'OVERDUE' || status === 'DELAYED' || status === 'COMPLETED') {
      counts[status] += 1;
    }
  });

  return counts;
}

function buildTodoStatusCounts(items: SupervisionItem[], user: MyItemsUser): Partial<Record<ItemStatus, number>> {
  return items.reduce<Partial<Record<ItemStatus, number>>>((counts, item) => {
    const status = getTodoStatus(item, user);
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

export function buildMyItemsScope(items: SupervisionItem[], user: MyItemsUser): MyItemsScope {
  const visibleItems = items.filter(isVisibleMyItem);
  const ownedItems = visibleItems.filter(item => isItemOwnerForUser(item, user));
  const followedItems = visibleItems.filter(item => isItemFollowerForUser(item, user));
  const relatedItems = uniqueItems([...ownedItems, ...followedItems]);
  const todoItems = relatedItems.filter(item => !TODO_EXCLUDED_STATUSES.includes(getTodoStatus(item, user)));

  return {
    ownedItems,
    followedItems,
    todoItems,
    ownerStatusCounts: buildStatusCounts(ownedItems, user, 'owner'),
    followerStatusCounts: buildStatusCounts(followedItems, user, 'follower'),
    todoStatusCounts: buildTodoStatusCounts(todoItems, user),
  };
}

export function filterMyItemsByStatus(
  items: SupervisionItem[],
  user: MyItemsUser,
  role: MyItemsRoleTabKey,
  statusTab: MyItemsStatusTabKey,
): SupervisionItem[] {
  if (statusTab === 'all') return items;
  return items.filter(item => getMyRoleScopedStatus(item, user, role) === statusTab);
}
