import { Message, UrgeRecord } from '../types';

type MessagePayload = Omit<Message, 'id' | 'timestamp' | 'read'>;
type UrgePayload = Omit<UrgeRecord, 'id' | 'timestamp'>;

function trimToUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeMessagePayload(message: MessagePayload): MessagePayload {
  const receiverId = trimToUndefined(message.receiverId);
  const receiverName = trimToUndefined(message.receiverName);
  const senderId = trimToUndefined(message.senderId);
  const senderName = trimToUndefined(message.senderName);
  const rest = {
    title: message.title,
    content: message.content,
    type: message.type,
    ...(message.link ? { link: message.link } : {}),
  };

  return {
    ...rest,
    ...(receiverId ? { receiverId } : {}),
    ...(receiverName ? { receiverName } : {}),
    ...(senderId ? { senderId } : {}),
    ...(senderName ? { senderName } : {}),
  };
}

export function normalizeUrgePayload(record: UrgePayload): UrgePayload {
  const receiverId = trimToUndefined(record.receiverId);
  const senderId = trimToUndefined(record.senderId);
  const receiver = trimToUndefined(record.receiver) || '';
  const sender = trimToUndefined(record.sender) || '';
  const rest = {
    itemId: record.itemId,
    itemTitle: record.itemTitle,
    status: record.status,
    method: record.method,
    ...(record.content ? { content: record.content } : {}),
    ...(record.responseContent ? { responseContent: record.responseContent } : {}),
  };

  return {
    ...rest,
    ...(receiverId ? { receiverId } : {}),
    receiver,
    ...(senderId ? { senderId } : {}),
    sender,
  };
}
