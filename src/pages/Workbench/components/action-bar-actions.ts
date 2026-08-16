import { SupervisionItem, User } from '../../../types';
import { getEffectiveItemStatus, getUserIdentityKeys, isItemOwnerForUser } from '../../../lib/item-format';

/** 已关闭/办结状态：这些状态下事项不可再签收或反馈 */
const CLOSED_STATUSES = new Set(['COMPLETED', 'ARCHIVED', 'DISABLED', 'DELETED', 'NOT_SATISFIED']);

function normalizeIdentity(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

function identitySet(user: Pick<User, 'id' | 'name' | 'username'>): Set<string> {
  return new Set(getUserIdentityKeys(user));
}

/** 某责任人是否已签收：时间轴存在该用户身份的 SIGN 节点 */
function hasUserSigned(item: SupervisionItem, user: Pick<User, 'id' | 'name' | 'username'>): boolean {
  const ids = identitySet(user);
  return (item.timeline || []).some(node => node.type === 'SIGN' && node.user != null && ids.has(normalizeIdentity(node.user)));
}

/** 一键签收全部：自己名下的所有「未签收」督办事项（多责任人时按各自身份独立判定）。
 * 仅判断本人是否签收，不要求全部责任人签收；本人未签即可纳入。已关闭/办结状态不纳入。 */
export function getBulkSignableItems(items: SupervisionItem[], user: Pick<User, 'id' | 'name' | 'username'>): SupervisionItem[] {
  return items.filter(item => {
    if (!isItemOwnerForUser(item, user)) return false;
    if (CLOSED_STATUSES.has(getEffectiveItemStatus(item))) return false;
    return !hasUserSigned(item, user);
  });
}

/** 批量反馈：自己名下「已签收（全部责任人完成签收）且尚无任何反馈记录」的督办事项。
 * 与工作台「未反馈」卡片口径一致（多责任人时全部责任人签收且无任何人反馈）。已关闭/办结状态不纳入。 */
export function getBulkFeedbackItems(items: SupervisionItem[], user: Pick<User, 'id' | 'name' | 'username'>): SupervisionItem[] {
  return items.filter(item => {
    if (!isItemOwnerForUser(item, user)) return false;
    if (CLOSED_STATUSES.has(getEffectiveItemStatus(item))) return false;
    const owners = new Set<string>();
    const push = (v?: string | null) => { if (v && v.trim()) owners.add(v.trim()); };
    push(item.ownerName);
    (item.ownerNames || []).forEach(push);
    if (owners.size === 0) return false; // 无责任人视为已签收，不纳入反馈范围
    const signedOwners = new Set<string>();
    for (const node of item.timeline || []) {
      if (node.type === 'SIGN' && node.user && node.user.trim()) signedOwners.add(node.user.trim());
    }
    const allSigned = owners.size > 0 && owners.size === signedOwners.size;
    if (!allSigned) return false;
    const hasFeedback = Boolean(
      (item as unknown as Record<string, unknown>).lastFeedbackDate ||
      (item.timeline || []).some(node => node.type === 'FEEDBACK' || node.type === 'FOLLOWER_FEEDBACK'),
    );
    return !hasFeedback;
  });
}
