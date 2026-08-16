interface ItemIdentityLike {
  ownerId?: string | null;
  ownerName?: string | null;
  followerId?: string | null;
  followerName?: string | null;
}

interface UserIdentityLike {
  id: string;
  name?: string | null;
  username?: string | null;
}

function normalize(value?: string | null): string {
  return (value || '').trim();
}

function findUserIdByLabel(label: string, users: UserIdentityLike[]): string | null {
  if (!label) return null;

  const matched = users.find(user => normalize(user.name) === label || normalize(user.username) === label);
  return matched?.id || null;
}

export function getItemIdentityBackfill(
  item: ItemIdentityLike,
  users: UserIdentityLike[],
): { ownerId?: string; followerId?: string } | null {
  const updates: { ownerId?: string; followerId?: string } = {};

  if (!item.ownerId) {
    const ownerId = findUserIdByLabel(normalize(item.ownerName), users);
    if (ownerId) updates.ownerId = ownerId;
  }

  if (!item.followerId) {
    const followerId = findUserIdByLabel(normalize(item.followerName), users);
    if (followerId) updates.followerId = followerId;
  }

  return Object.keys(updates).length > 0 ? updates : null;
}
