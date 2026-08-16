// 督办转交的纯逻辑（不依赖 db / express），便于复用与单测。

export type ReassignScope = 'OWNER' | 'FOLLOWER' | 'ALL';

export interface ReassignUserLike {
  id: string;
  name: string;
  status?: string;
}

/**
 * 把 DB 行里的 ownerIds/followerIds/subTasks 等字段安全转成字符串数组。
 * 兼容 mysql JSON 直接返回数组，以及历史字符串化存储两种情况。
 */
export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  if (typeof value === 'string' && value.length > 0) {
    try {
      return asStringArray(JSON.parse(value));
    } catch {
      return [value];
    }
  }
  return [];
}

/**
 * 按 scope 从所有未删除事项中筛出命中「来源人」的事项。
 * OWNER：来源人是责任人（单字段 ownerId 或数组 ownerIds 命中）
 * FOLLOWER：来源人是跟进人（单字段 followerId 或数组 followerIds 命中）
 * ALL：任一命中
 */
export function matchItems(allItems: any[], fromUser: ReassignUserLike, scope: ReassignScope): any[] {
  // 已删除事项不参与转交（路由层亦用 isNull(deletedAt) 双保险）
  return allItems.filter((item: any) => {
    if (item.deletedAt) return false;
    const ownerIds = asStringArray(item.ownerIds);
    const followerIds = asStringArray(item.followerIds);
    const isOwner = item.ownerId === fromUser.id || ownerIds.includes(fromUser.id);
    const isFollower = item.followerId === fromUser.id || followerIds.includes(fromUser.id);
    if (scope === 'OWNER') return isOwner;
    if (scope === 'FOLLOWER') return isFollower;
    return isOwner || isFollower;
  });
}

/**
 * 冲突检测：目标人(toUser) 已出现在命中事项的对应范围内。
 * 为保证「状态完全不变」，一旦冲突就整体阻断（不静默合并）。
 */
export function detectReassignConflicts(
  matchedItems: any[],
  toUser: ReassignUserLike,
  scope: ReassignScope,
): string[] {
  const conflicts: string[] = [];
  for (const item of matchedItems) {
    const ownerIds = asStringArray(item.ownerIds);
    const followerIds = asStringArray(item.followerIds);
    const ownerConflict = item.ownerId === toUser.id || ownerIds.includes(toUser.id);
    const followerConflict = item.followerId === toUser.id || followerIds.includes(toUser.id);
    if (scope === 'OWNER' && ownerConflict) conflicts.push(item.serialNo || item.id);
    else if (scope === 'FOLLOWER' && followerConflict) conflicts.push(item.serialNo || item.id);
    else if (scope === 'ALL' && (ownerConflict || followerConflict)) conflicts.push(item.serialNo || item.id);
  }
  return conflicts;
}

export interface ReassignUpdateResult {
  update: Record<string, unknown>;
  didOwner: boolean;
  didFollower: boolean;
}

/**
 * 计算单条事项的更新值（纯函数，便于单测）。
 * 关键约束：
 *  - 只替换「身份」（ownerIds/ownerNames、subTasks[].assigneeId/assigneeName、followerId(s)），
 *    不触碰 items.status、subTasks[].status、deadline、progress、content、反馈、附件、催办等任何业务数据。
 *  - 旧版单字段(ownerId/followerId) 与 新版数组(ownerIds/followerIds) 同步替换并保持一致。
 *  - 父事项有效状态由 subTasks 聚合，因 status 等保留，聚合结果与原来完全一致。
 */
export function computeReassignUpdate(
  item: any,
  fromUser: ReassignUserLike,
  toUser: ReassignUserLike,
  scope: ReassignScope,
): ReassignUpdateResult {
  const ownerIds = asStringArray(item.ownerIds);
  const ownerNames = asStringArray(item.ownerNames);
  const followerIds = asStringArray(item.followerIds);
  const followerNames = asStringArray(item.followerNames);
  const subTasks: any[] = Array.isArray(item.subTasks) ? item.subTasks : [];

  const update: Record<string, unknown> = {};
  let didOwner = false;
  let didFollower = false;

  const touchesOwner = scope === 'OWNER' || scope === 'ALL';
  const touchesFollower = scope === 'FOLLOWER' || scope === 'ALL';

  if (touchesOwner) {
    const isOwner = item.ownerId === fromUser.id || ownerIds.includes(fromUser.id);
    if (isOwner) {
      if (item.ownerId === fromUser.id) {
        update.ownerId = toUser.id;
        update.ownerName = toUser.name;
      }
      // 数组为空但单字段命中时，用单字段构造数组，保持两套口径一致
      const srcOwnerIds = ownerIds.length > 0 || item.ownerId !== fromUser.id ? ownerIds : [fromUser.id];
      const srcOwnerNames = ownerNames.length > 0 || item.ownerId !== fromUser.id ? ownerNames : [fromUser.name];
      const newOwnerIds: string[] = [];
      const newOwnerNames: string[] = [];
      srcOwnerIds.forEach((id, idx) => {
        if (id === fromUser.id) {
          newOwnerIds.push(toUser.id);
          newOwnerNames.push(toUser.name);
        } else {
          newOwnerIds.push(id);
          newOwnerNames.push(srcOwnerNames[idx] ?? id);
        }
      });
      update.ownerIds = newOwnerIds;
      update.ownerNames = newOwnerNames;
      // 子任务：仅换责任人身份，所有状态/进度/计划完成日原样保留
      if (subTasks.length > 0) {
        update.subTasks = subTasks.map((st: any) =>
          st && st.assigneeId === fromUser.id
            ? { ...st, assigneeId: toUser.id, assigneeName: toUser.name }
            : st,
        );
      }
      didOwner = true;
    }
  }

  if (touchesFollower) {
    const isFollower = item.followerId === fromUser.id || followerIds.includes(fromUser.id);
    if (isFollower) {
      if (item.followerId === fromUser.id) {
        update.followerId = toUser.id;
        update.followerName = toUser.name;
      }
      const srcFollowerIds = followerIds.length > 0 || item.followerId !== fromUser.id ? followerIds : [fromUser.id];
      const srcFollowerNames = followerNames.length > 0 || item.followerId !== fromUser.id ? followerNames : [fromUser.name];
      const newFollowerIds: string[] = [];
      const newFollowerNames: string[] = [];
      srcFollowerIds.forEach((id, idx) => {
        if (id === fromUser.id) {
          newFollowerIds.push(toUser.id);
          newFollowerNames.push(toUser.name);
        } else {
          newFollowerIds.push(id);
          newFollowerNames.push(srcFollowerNames[idx] ?? id);
        }
      });
      update.followerIds = newFollowerIds;
      update.followerNames = newFollowerNames;
      didFollower = true;
    }
  }

  return { update, didOwner, didFollower };
}
