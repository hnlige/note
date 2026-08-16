type MessageLinkLike = {
  link?: string | null;
};

export function getItemIdFromMessageLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const match = link.match(/^\/items\/([^/?#]+)$/);
  return match?.[1] || null;
}

export function getLinkedItemIds(messages: MessageLinkLike[]): string[] {
  return Array.from(new Set(messages.map((message) => getItemIdFromMessageLink(message.link)).filter((id): id is string => Boolean(id))));
}

export function filterMessagesWithExistingItemLinks<T extends MessageLinkLike>(
  messages: T[],
  existingItemIds: ReadonlySet<string>,
): T[] {
  return messages.filter((message) => {
    const itemId = getItemIdFromMessageLink(message.link);
    return !itemId || existingItemIds.has(itemId);
  });
}
