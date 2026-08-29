/**
 * item_access 关联表维护模块（行级权限索引化改造的核心）。
 *
 * 设计要点：
 * - 与 items 表的 JSON 人员列（owner_ids/follower_ids/sub_tasks/shared_with）双写；
 *   读路径通过 ITEM_ACCESS_QUERY_MODE=access 切换为 EXISTS 索引查询（默认 json 走旧逻辑）。
 * - relation 语义必须与 access.policy.ts 的旧 WHERE 完全镜像：
 *   OWNER   = owner_id ∪ owner_ids ∪ 姓名匹配（owner_name/owner_names → 活跃用户）
 *   FOLLOWER= follower_id ∪ follower_ids ∪ 姓名匹配（follower_name/follower_names）
 *   ASSIGNEE= sub_tasks[*].assigneeId ∪ 姓名匹配（assigneeName）
 *   SHARE   = shared_with[*].userId（旧语义仅按 userId 匹配，不含 userName）
 * - 姓名匹配按「全部活跃用户同名者」展开，镜像旧 WHERE 的 inArray(name, names) 行为
 *   （同名用户互相可见是历史语义，对账以它为准）。
 */
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { schema } from '../db';
import { normalizeItemJsonFields, backfillItemUserIdentities } from './items';

export const ITEM_ACCESS_RELATIONS = {
  OWNER: 'OWNER',
  FOLLOWER: 'FOLLOWER',
  ASSIGNEE: 'ASSIGNEE',
  SHARE: 'SHARE',
} as const;

export type ItemAccessQueryMode = 'json' | 'access';

const ITEM_RELATION_FIELDS = new Set([
  'ownerId', 'ownerName', 'ownerIds', 'ownerNames',
  'followerId', 'followerName', 'followerIds', 'followerNames',
  'subTasks', 'sharedWith',
]);

/** 更新 payload 是否触及人员关系字段；未触及时跳过 item_access 重建（反馈/状态等高频写路径）。 */
export function payloadTouchesItemRelations(payload: Record<string, unknown> | null | undefined): boolean {
  if (!payload) return false;
  return Object.keys(payload).some((field) => ITEM_RELATION_FIELDS.has(field));
}

export function getItemAccessQueryMode(env: Partial<Pick<NodeJS.ProcessEnv, 'ITEM_ACCESS_QUERY_MODE'>> = process.env): ItemAccessQueryMode {
  return env.ITEM_ACCESS_QUERY_MODE === 'access' ? 'access' : 'json';
}

export interface AccessUserLike {
  id: string;
  name?: string | null;
  status?: string | null;
}

type NormalizedItem = Record<string, any>;

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
  if (typeof value === 'string' && value.trim() !== '') {
    // 历史 TEXT 列可能存 JSON 字符串
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string' && entry !== '') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asObjectList(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry));
  return [];
}

/** 姓名匹配镜像旧 WHERE 的 inArray(name, names)：全部同名活跃用户都获得该关系。 */
export function buildActiveUserNameIndex(users: Array<AccessUserLike>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const user of users) {
    if (!user?.id || user.status === 'DISABLED') continue;
    const name = typeof user.name === 'string' ? user.name.trim() : '';
    if (!name) continue;
    const existing = index.get(name);
    if (existing) {
      if (!existing.includes(user.id)) existing.push(user.id);
    } else {
      index.set(name, [user.id]);
    }
  }
  return index;
}

function expandByNames(ids: string[], names: string[], nameIndex: Map<string, string[]>): string[] {
  const out = new Set<string>();
  for (const id of ids) if (id) out.add(id);
  for (const name of names) {
    for (const id of nameIndex.get(name) || []) out.add(id);
  }
  return [...out];
}

/** 从（已规范化+已回填身份的）事项行派生 item_access 关系行。纯函数，便于单测与对账。 */
export function deriveItemAccessRows(
  item: NormalizedItem,
  users: Array<AccessUserLike>,
): Array<{ itemId: string; userId: string; relation: string }> {
  const itemId = typeof item?.id === 'string' ? item.id : '';
  if (!itemId) return [];
  const nameIndex = buildActiveUserNameIndex(users);

  const ownerIds = [...asStringList(item.ownerIds), ...(item.ownerId ? [String(item.ownerId)] : [])];
  const ownerNames = [...asStringList(item.ownerNames), ...(typeof item.ownerName === 'string' && item.ownerName.trim() ? [item.ownerName.trim()] : [])];
  const followerIds = [...asStringList(item.followerIds), ...(item.followerId ? [String(item.followerId)] : [])];
  const followerNames = [...asStringList(item.followerNames), ...(typeof item.followerName === 'string' && item.followerName.trim() ? [item.followerName.trim()] : [])];

  const assigneeIds: string[] = [];
  const assigneeNames: string[] = [];
  for (const subTask of asObjectList(item.subTasks)) {
    // 旧 WHERE 的 JSON_SEARCH 匹配 assignee 时不区分子任务状态（含 DELETED），此处保持同口径
    if (typeof subTask.assigneeId === 'string' && subTask.assigneeId) assigneeIds.push(subTask.assigneeId);
    if (typeof subTask.assigneeName === 'string' && subTask.assigneeName.trim()) assigneeNames.push(subTask.assigneeName.trim());
  }
  const shareIds = asObjectList(item.sharedWith)
    .map((entry) => (typeof entry.userId === 'string' ? entry.userId : ''))
    .filter(Boolean);

  const rows = new Map<string, { itemId: string; userId: string; relation: string }>();
  const add = (userId: string, relation: string) => {
    if (!userId) return;
    rows.set(`${userId}\u0000${relation}`, { itemId, userId, relation });
  };
  for (const userId of expandByNames(ownerIds, ownerNames, nameIndex)) add(userId, ITEM_ACCESS_RELATIONS.OWNER);
  for (const userId of expandByNames(followerIds, followerNames, nameIndex)) add(userId, ITEM_ACCESS_RELATIONS.FOLLOWER);
  for (const userId of expandByNames(assigneeIds, assigneeNames, nameIndex)) add(userId, ITEM_ACCESS_RELATIONS.ASSIGNEE);
  for (const userId of shareIds) add(userId, ITEM_ACCESS_RELATIONS.SHARE);

  return [...rows.values()];
}

async function loadAllUsers(db: any): Promise<AccessUserLike[]> {
  return db.select({ id: schema.users.id, name: schema.users.name, status: schema.users.status }).from(schema.users) as Promise<AccessUserLike[]>;
}

/**
 * 重建单条事项的可见性关联（读最新行 → 派生 → 删旧插新）。
 * 可传入事务客户端保证与事项写入原子；users 缺省时直接查 users 表。
 */
export async function rebuildItemAccessForItem(dbOrTx: any, itemId: string, users?: Array<AccessUserLike>): Promise<number> {
  const [row] = await dbOrTx.select().from(schema.items).where(eq(schema.items.id, itemId)).limit(1);
  if (!row) {
    await dbOrTx.delete(schema.itemAccess).where(eq(schema.itemAccess.itemId, itemId));
    return 0;
  }
  const knownUsers = users || await loadAllUsers(dbOrTx);
  const normalized = normalizeItemJsonFields(row);
  const backfilled = await backfillItemUserIdentities(dbOrTx, [normalized], knownUsers as any);
  const rows = deriveItemAccessRows(backfilled[0] || normalized, knownUsers);
  await dbOrTx.delete(schema.itemAccess).where(eq(schema.itemAccess.itemId, itemId));
  if (rows.length > 0) {
    await dbOrTx.insert(schema.itemAccess).values(rows as any);
  }
  return rows.length;
}

/** 批量重建（POST /batch、reassign 等一次改多条的场景）。 */
export async function rebuildItemAccessForItems(dbOrTx: any, itemIds: string[], users?: Array<AccessUserLike>): Promise<number> {
  let total = 0;
  for (const itemId of itemIds) {
    total += await rebuildItemAccessForItem(dbOrTx, itemId, users);
  }
  return total;
}

/**
 * 全量回填：游标分页遍历 items 重建关联（幂等，可重复执行修复）。
 * 用于部署后的一次性迁移 / 对账修复。
 */
export async function rebuildAllItemAccess(db: any, options: { batchSize?: number; log?: (msg: string) => void } = {}): Promise<{ items: number; rows: number }> {
  const batchSize = options.batchSize || 200;
  const log = options.log || (() => undefined);
  const users = await loadAllUsers(db);
  let cursor: string | null = null;
  let items = 0;
  let rows = 0;
  for (;;) {
    const page = await db
      .select({ id: schema.items.id })
      .from(schema.items)
      .where(cursor ? and(gt(schema.items.id, cursor)) : undefined)
      .orderBy(asc(schema.items.id))
      .limit(batchSize);
    if (page.length === 0) break;
    for (const { id } of page) {
      rows += await rebuildItemAccessForItem(db, id, users);
      items += 1;
    }
    cursor = page[page.length - 1].id;
    log(`item_access backfill: ${items} items, ${rows} rows`);
  }
  return { items, rows };
}

type PoolWithGetConnection = { getConnection(): Promise<any> };

/**
 * 启动时回填：仅当 item_access 为空且 items 有数据时执行（MySQL GET_LOCK 防多 PM2 实例并发）。
 * pool 传 mysql2 连接池（db.session.client）。
 */
export async function ensureItemAccessBackfillAtStartup(db: any, pool: PoolWithGetConnection): Promise<boolean> {
  const countOf = async (table: unknown) => {
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(table as never);
    return Number(row?.count || 0);
  };
  const itemCount = await countOf(schema.items);
  if (itemCount === 0) return false;
  if (await countOf(schema.itemAccess) > 0) return false;

  const conn = await pool.getConnection();
  try {
    const [lockRows] = await conn.query("SELECT GET_LOCK('duban:item-access-backfill', 0) AS locked") as unknown as [Array<{ locked: number }>];
    if (Number(lockRows?.[0]?.locked) !== 1) return false;
    try {
      // 拿到锁后复查（另一实例可能刚回填完）
      if (await countOf(schema.itemAccess) > 0) return false;
      const { items, rows } = await rebuildAllItemAccess(db);
      console.log(`[item-access] startup backfill done: ${items} items, ${rows} access rows`);
      return true;
    } finally {
      await conn.query("DO RELEASE_LOCK('duban:item-access-backfill')");
    }
  } finally {
    conn.release();
  }
}
