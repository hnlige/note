import { Message } from '../types';

type ExistingItemLike = { id: string };

export function normalizeVisibleMessageContent(content: unknown): string {
  if (typeof content !== 'string') return '';
  return content.replace(/催办：undefined\s*$/u, '催办：请及时查看并反馈处理进展。');
}

function normalizeVisibleMessage(message: Message): Message {
  return {
    ...message,
    content: normalizeVisibleMessageContent(message.content),
  };
}

function getItemIdFromMessageLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const match = link.match(/^\/items\/([^/?#]+)$/);
  return match?.[1] || null;
}

function isMessageLinkedItemActionable(
  message: Pick<Message, 'link'>,
  existingItemIds?: ReadonlySet<string>,
): boolean {
  if (!existingItemIds) return true;
  const linkedItemId = getItemIdFromMessageLink(message.link);
  return !linkedItemId || existingItemIds.has(linkedItemId);
}

/**
 * 判断一条消息是否属于「面向用户的消息」。
 *
 * 历史约定：系统通知(NOTICE)默认不在消息中心/通知中心展示，避免与待办、催办混在一起。
 * 但《消息列表》需要独立的「系统通知」分类，因此通过 includeNotice 显式开启后，
 * NOTICE 消息也会纳入可见范围（消息列表页传 true）。
 */
function isUserFacingMessage(message: Pick<Message, 'type'>, includeNotice = false): boolean {
  if (includeNotice) return true;
  return message.type !== 'NOTICE';
}

/**
 * 判断一条消息是否对当前用户可见。
 *
 * 语义（与后端 isMessageVisibleToUser 保持一致）：
 * - 无 receiverId 且无 receiverName 视为广播消息，所有人可见
 * - 管理员可见全部
 * - 有 receiverId 时按 ID 优先判断
 * - 仅在缺失 receiverId 时回退到 receiverName
 */
export function isMessageVisibleToCurrentUser(
  message: Pick<Message, 'receiverId' | 'receiverName'>,
  currentUser: { id: string; role: string; name?: string },
): boolean {
  if (!message.receiverId && !message.receiverName) return true; // 广播消息
  if (currentUser.role === 'ADMIN') return true; // 管理员看到全部
  if (message.receiverId) return message.receiverId === currentUser.id;
  return message.receiverName === currentUser.name; // 兼容旧数据
}

/**
 * 从消息列表中过滤出当前用户可见的消息。
 */
export function getVisibleMessages(
  messages: readonly Message[],
  currentUser: { id: string; role: string; name?: string },
  existingItems?: readonly ExistingItemLike[],
  options?: { includeNotice?: boolean },
): Message[] {
  const existingItemIds = existingItems ? new Set(existingItems.map((item) => item.id)) : undefined;
  return messages
    .filter((m) =>
      isUserFacingMessage(m, options?.includeNotice)
      && isMessageVisibleToCurrentUser(m, currentUser)
      && isMessageLinkedItemActionable(m, existingItemIds)
    )
    .map(normalizeVisibleMessage);
}

/**
 * 计算当前用户可见的未读消息数。
 */
export function getUnreadVisibleMessageCount(
  messages: readonly Message[],
  currentUser: { id: string; role: string; name?: string },
  existingItems?: readonly ExistingItemLike[],
): number {
  return getVisibleMessages(messages, currentUser, existingItems).filter((m) => !m.read).length;
}
