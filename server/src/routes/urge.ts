import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { AuthenticatedRequest } from './auth.middleware';
import { getCurrentAccessContext } from './access.context';
import {
  canManageUrges,
  canReadUrges,
  canReplyUrge,
  getMessageTargetIdentities,
  hasGlobalModuleAccess,
  isUrgeVisibleToUser,
} from './module-authz';
import { ensureNotificationIdentityColumns } from './notification.schema';
import { filterItemsByAccess, type AccessItemLike } from './access.policy';
import { eq, and, desc, sql, inArray, gte, lte, like } from 'drizzle-orm';
import { createHash } from 'node:crypto';

// 已完成/废弃/关闭/删除/归档的事项或子任务不允许催办，不计次。
const URGE_EXCLUDE = new Set(['COMPLETED', 'CLOSED', 'DISABLED', 'ARCHIVED', 'DELETED']);

export const urgeRouter = Router();

export function normalizeUrgeContent(content: unknown): string {
  return typeof content === 'string' && content.trim().length > 0
    ? content.trim()
    : '请及时查看并反馈处理进展。';
}

/**
 * `urge_records.idempotency_key` is varchar(64). A batch key also needs to
 * include the item, subtask and receiver, otherwise two items for the same
 * receiver could be incorrectly treated as one request.
 */
export function buildBatchUrgeIdempotencyKey(
  requestKey: string,
  itemId: string,
  subTaskId: string | null,
  receiverId: string,
): string {
  return createHash('sha256')
    .update(`${requestKey}\u0000${itemId}\u0000${subTaskId || 'root'}\u0000${receiverId}`)
    .digest('hex');
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  if (typeof value === 'string') {
    try { return asStringArray(JSON.parse(value)); } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function parseSubTasks(item: Record<string, any>): any[] {
  const raw = (item as any)?.subTasks;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function isUrgeableStatus(status?: string | null): boolean {
  return !status || !URGE_EXCLUDE.has(status);
}

export interface UrgeTarget {
  subTaskId: string | null;
  assigneeId: string;
  assigneeName?: string | null;
  status?: string | null;
}

// 收集事项下所有可被催办的责任人：优先展开子任务责任人；若无子任务责任人则回退到主责任人与跟进人。
export function collectItemUrgeTargets(item: Record<string, any>): UrgeTarget[] {
  const out: UrgeTarget[] = [];
  const subTasks = parseSubTasks(item);
  for (const st of subTasks) {
    if (st && st.assigneeId) {
      out.push({
        subTaskId: st.id ?? null,
        assigneeId: st.assigneeId,
        assigneeName: st.assigneeName ?? null,
        status: st.status ?? null,
      });
    }
  }
  if (out.length === 0) {
    const ownerIds = Array.isArray(item.ownerIds)
      ? item.ownerIds
      : item.ownerId
        ? [item.ownerId]
        : [];
    const ownerNames = Array.isArray(item.ownerNames)
      ? item.ownerNames
      : item.ownerName
        ? [item.ownerName]
        : [];
    ownerIds.forEach((id: string, idx: number) => {
      if (id) out.push({ subTaskId: null, assigneeId: id, assigneeName: ownerNames[idx] ?? null, status: item.status ?? null });
    });
    const followerIds = Array.isArray(item.followerIds)
      ? item.followerIds
      : item.followerId
        ? [item.followerId]
        : [];
    followerIds.forEach((id: string) => {
      if (id) out.push({ subTaskId: null, assigneeId: id, assigneeName: null, status: item.status ?? null });
    });
  }
  return out;
}

export function getUrgeTargetIds(item: Record<string, any>): string[] {
  const subTaskIds = parseSubTasks(item).map((task: any) => task?.assigneeId).filter(Boolean);
  return [...new Set([
    item.ownerId,
    ...asStringArray(item.ownerIds),
    item.followerId,
    ...asStringArray(item.followerIds),
    ...subTaskIds,
  ].filter(Boolean))] as string[];
}

type UrgeRow = {
  id: string;
  itemId: string;
  itemTitle: string;
  senderId: string | null;
  sender: string;
  receiverId: string | null;
  receiver: string;
  method: string;
  content: string | null;
  status: string;
  subTaskId: string | null;
  batchId: string | null;
  idempotencyKey: string | null;
  scope: string;
  source: string;
  result: string;
  timestamp: Date;
};

function buildUrgeRecord(params: {
  recordId: string;
  itemId: string;
  itemTitle: string;
  senderId: string | null;
  sender: string;
  receiverId: string | null;
  receiver: string;
  method: string;
  content: string;
  subTaskId: string | null;
  batchId: string | null;
  idempotencyKey: string | null;
  scope: string;
  source: string;
  now: Date;
}): UrgeRow {
  return {
    id: params.recordId,
    itemId: params.itemId,
    itemTitle: params.itemTitle,
    senderId: params.senderId,
    sender: params.sender,
    receiverId: params.receiverId,
    receiver: params.receiver,
    method: params.method,
    content: params.content,
    status: 'UNREAD',
    subTaskId: params.subTaskId,
    batchId: params.batchId,
    idempotencyKey: params.idempotencyKey,
    scope: params.scope,
    source: params.source,
    result: 'SUCCESS',
    timestamp: params.now,
  };
}

// 单条催办（责任人级）。subTaskId 可选；幂等键可选，传入后同键重试不重复计次。
urgeRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    await ensureNotificationIdentityColumns(db);
    const { urgeRecords: urgeTable, messages: messagesTable, users: usersTable, items: itemsTable, timelineNodes, operationLogs } = await import('../db/schema');
    const { v4: uuid } = await import('uuid');
    const now = new Date();
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canManageUrges(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无催办操作权限' });
    }

    const { id: clientId, itemId, receiverId, receiver, content, method, subTaskId, scope, source, idempotencyKey } = req.body;
    if (typeof itemId !== 'string' || !itemId || typeof receiverId !== 'string' || !receiverId) {
      return res.status(400).json({ error: '事项和催办接收人不能为空' });
    }
    const [item] = await db.select().from(itemsTable).where(eq(itemsTable.id, itemId)).limit(1);
    if (!item) return res.status(404).json({ error: '催办事项不存在' });
    if (filterItemsByAccess([item as AccessItemLike], accessContext).length === 0) {
      return res.status(403).json({ error: '当前事项不在您的数据权限范围内' });
    }

    // 服务端校验：接收人必须属于该事项（子任务责任人 / 主责任人 / 跟进人），不信任前端参数。
    const targets = collectItemUrgeTargets(item as Record<string, any>);
    const match = targets.find((t) =>
      t.assigneeId === receiverId && (subTaskId ? t.subTaskId === subTaskId : true),
    );
    if (!match) {
      return res.status(403).json({ error: '只能催办该事项的责任人或跟进人' });
    }
    if (!isUrgeableStatus(match.status)) {
      return res.status(409).json({ error: '该责任人所属任务已完成/废弃/关闭，不可催办' });
    }

    const normalizedContent = normalizeUrgeContent(content);
    const users = await db.select({ id: usersTable.id, name: usersTable.name, username: usersTable.username }).from(usersTable);
    const identities = getMessageTargetIdentities(
      {
        receiverId: receiverId || null,
        receiverName: receiver || null,
        senderId: accessContext.currentUser.id,
        senderName: accessContext.currentUser.name,
      },
      users,
    );
    if (!identities.receiverId) return res.status(400).json({ error: '催办接收人不存在' });
    const normalizedMethod = ['SYSTEM', 'MESSAGE', 'PHONE'].includes(method) ? method : 'MESSAGE';

    const recordId = clientId || uuid();
    const effectiveIdempotencyKey = typeof idempotencyKey === 'string' && idempotencyKey ? idempotencyKey : uuid();
    const record = buildUrgeRecord({
      recordId,
      itemId,
      itemTitle: item.title,
      senderId: identities.senderId || null,
      sender: identities.senderName || accessContext.currentUser.name,
      receiverId: identities.receiverId || null,
      receiver: identities.receiverName || '',
      method: normalizedMethod,
      content: normalizedContent,
      subTaskId: match.subTaskId,
      batchId: null,
      idempotencyKey: effectiveIdempotencyKey,
      scope: typeof scope === 'string' && scope ? scope : 'SINGLE_ASSIGNEE',
      source: typeof source === 'string' && source ? source : 'MANUAL',
      now,
    });

    // 幂等：同键已存在则视为重复提交，返回原记录、不再计次。
    const [existing] = await db.select({ id: urgeTable.id }).from(urgeTable).where(eq(urgeTable.idempotencyKey, effectiveIdempotencyKey)).limit(1);
    if (existing) {
      return res.status(200).json({ success: true, id: existing.id, deduplicated: true });
    }

    const newMessage = {
      id: uuid(),
      title: '催办通知',
      content: `您负责的【${item.title}】收到来自 ${identities.senderName || accessContext.currentUser.name} 的催办：${normalizedContent}`,
      type: 'URGE',
      timestamp: now,
      read: false,
      link: `/items/${itemId}`,
      receiverId: identities.receiverId || null,
      receiverName: identities.receiverName || null,
      senderId: identities.senderId || null,
      senderName: identities.senderName || accessContext.currentUser.name,
    };

    await db.transaction(async (tx: any) => {
      await tx.insert(urgeTable).values(record as never);
      await tx.insert(messagesTable).values(newMessage as never);
      await tx.insert(timelineNodes).values({
        id: uuid(),
        itemId,
        type: 'URGE',
        user: identities.senderName || accessContext.currentUser.name,
        content: `【催办】${normalizedContent} (${normalizedMethod})`,
        timestamp: now,
      } as never);
      await tx.insert(operationLogs).values({
        id: uuid(),
        userId: accessContext.currentUser.id,
        userName: accessContext.currentUser.name,
        action: 'URGE_ITEM',
        module: 'MONITORING',
        detail: JSON.stringify({ itemId, subTaskId: match.subTaskId, receiverId: identities.receiverId, method: normalizedMethod, scope: record.scope }),
        ip: req.ip || 'unknown',
        timestamp: now,
      } as never);
    });

    return res.status(201).json({ success: true, id: recordId, deduplicated: false });
  } catch (error) {
    console.error('Create urge error:', error);
    return res.status(500).json({ error: '发起催办失败' });
  }
});

// 父级批量催办：对多个事项的“全部未完成子任务责任人”各计次 +1，所有明细归属同一 batchId。
urgeRouter.post('/batch', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    await ensureNotificationIdentityColumns(db);
    const { urgeRecords: urgeTable, messages: messagesTable, users: usersTable, items: itemsTable, timelineNodes, operationLogs } = await import('../db/schema');
    const { v4: uuid } = await import('uuid');
    const now = new Date();
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canManageUrges(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无催办操作权限' });
    }

    const itemIds = asStringArray(req.body?.itemIds);
    if (itemIds.length === 0) return res.status(400).json({ error: '请选择需要催办的督办事项' });
    const content = normalizeUrgeContent(req.body?.content);
    const method = ['SYSTEM', 'MESSAGE', 'PHONE'].includes(req.body?.method) ? req.body.method : 'MESSAGE';
    const requestKey = typeof req.body?.idempotencyKey === 'string' && req.body.idempotencyKey ? req.body.idempotencyKey : uuid();

    const items = await db.select().from(itemsTable).where(inArray(itemsTable.id, itemIds));
    const accessibleItems = filterItemsByAccess(items as AccessItemLike[], accessContext);
    if (accessibleItems.length === 0) return res.status(403).json({ error: '当前事项不在您的数据权限范围内' });

    const users = await db.select({ id: usersTable.id, name: usersTable.name, username: usersTable.username }).from(usersTable);
    const batchId = uuid();
    const senderName = accessContext.currentUser.name;
    const senderId = accessContext.currentUser.id;

    // 展开所有目标并区分“可催办 / 已跳过”。
    type Planned = { item: any; target: UrgeTarget };
    const planned: Planned[] = [];
    const skipped: Array<{ itemId: string; subTaskId: string | null; assigneeId: string; reason: string }> = [];
    for (const item of accessibleItems) {
      const targets = collectItemUrgeTargets(item as Record<string, any>);
      if (targets.length === 0) {
        skipped.push({ itemId: item.id, subTaskId: null, assigneeId: '', reason: 'NO_ASSIGNEE' });
        continue;
      }
      for (const target of targets) {
        if (!target.assigneeId) {
          skipped.push({ itemId: item.id, subTaskId: target.subTaskId, assigneeId: '', reason: 'NO_ASSIGNEE' });
          continue;
        }
        if (!isUrgeableStatus(target.status)) {
          skipped.push({ itemId: item.id, subTaskId: target.subTaskId, assigneeId: target.assigneeId, reason: 'EXCLUDED_STATUS' });
          continue;
        }
        planned.push({ item: item as any, target });
      }
    }
    if (planned.length === 0) {
      return res.status(409).json({ error: '所选事项均无有效可催办责任人（已完成/废弃/无责任人）', skipped });
    }

    const created: UrgeRow[] = [];
    let duplicateCount = 0;
    await db.transaction(async (tx: any) => {
      for (const { item, target } of planned) {
        const identities = getMessageTargetIdentities(
          { receiverId: target.assigneeId, receiverName: target.assigneeName ?? null, senderId, senderName },
          users,
        );
        if (!identities.receiverId) {
          skipped.push({ itemId: item.id, subTaskId: target.subTaskId, assigneeId: target.assigneeId, reason: 'RECEIVER_NOT_FOUND' });
          continue;
        }
        const key = buildBatchUrgeIdempotencyKey(requestKey, item.id, target.subTaskId, target.assigneeId);
        const [existing] = await tx.select({ id: urgeTable.id }).from(urgeTable).where(eq(urgeTable.idempotencyKey, key)).limit(1);
        if (existing) {
          duplicateCount += 1;
          continue;
        }
        const record = buildUrgeRecord({
          recordId: uuid(),
          itemId: item.id,
          itemTitle: item.title,
          senderId: identities.senderId || null,
          sender: identities.senderName || senderName,
          receiverId: identities.receiverId || null,
          receiver: identities.receiverName || '',
          method,
          content,
          subTaskId: target.subTaskId,
          batchId,
          idempotencyKey: key,
          scope: 'PARENT_BATCH',
          source: 'MANUAL',
          now,
        });
        await tx.insert(urgeTable).values(record as never);
        await tx.insert(messagesTable).values({
          id: uuid(),
          title: '催办通知',
          content: `您负责的【${item.title}】收到来自 ${identities.senderName || senderName} 的催办：${content}`,
          type: 'URGE',
          timestamp: now,
          read: false,
          link: `/items/${item.id}`,
          receiverId: identities.receiverId || null,
          receiverName: identities.receiverName || null,
          senderId: identities.senderId || null,
          senderName: identities.senderName || senderName,
        } as never);
        created.push(record);
      }

      // 每个被催办事项写一条时间轴节点（汇总，避免刷屏）。
      const perItemCount = new Map<string, number>();
      for (const { item } of planned) {
        perItemCount.set(item.id, (perItemCount.get(item.id) || 0) + 1);
      }
      for (const [itemId, count] of perItemCount.entries()) {
        await tx.insert(timelineNodes).values({
          id: uuid(),
          itemId,
          type: 'URGE',
          user: senderName,
          content: `【批量催办】向 ${count} 位责任人发起催办`,
          timestamp: now,
        } as never);
      }

      await tx.insert(operationLogs).values({
        id: uuid(),
        userId: senderId,
        userName: senderName,
        action: 'BATCH_URGE',
        module: 'MONITORING',
        detail: JSON.stringify({ itemIds, batchId, created: created.length, skipped: skipped.length }),
        ip: req.ip || 'unknown',
        timestamp: now,
      } as never);
    });

    return res.status(201).json({
      success: true,
      batchId,
      itemCount: accessibleItems.length,
      urgeableCount: planned.length,
      createdCount: created.length,
      duplicateCount,
      skipped,
    });
  } catch (error) {
    console.error('Batch urge error:', error);
    return res.status(500).json({ error: '批量催办失败' });
  }
});

// 回复催办：仅实际接收人可回复，管理员不可冒充责任人回复。
urgeRouter.put('/:id/reply', async (req: AuthenticatedRequest & Request<{ id: string }>, res: Response) => {
  try {
    const db = await getDb();
    await ensureNotificationIdentityColumns(db);
    const { urgeRecords: urgeTable } = await import('../db/schema');
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canReplyUrge(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无催办操作权限' });
    }

    const { responseContent } = req.body;
    const [record] = await db.select().from(urgeTable).where(eq(urgeTable.id, req.params.id as string)).limit(1);
    if (!record) {
      return res.status(404).json({ error: '催办记录不存在' });
    }
    const isReceiver = record.receiverId ? record.receiverId === accessContext.currentUser.id : record.receiver === accessContext.currentUser.name;
    if (!isReceiver) {
      return res.status(403).json({ error: '仅被催办的责任人本人可回复' });
    }

    await db
      .update(urgeTable)
      .set({ status: 'RESPONDED', responseContent } as never)
      .where(eq(urgeTable.id, req.params.id as string));

    return res.json({ success: true });
  } catch (error) {
    console.error('Reply urge error:', error);
    return res.status(500).json({ error: '回复催办失败' });
  }
});

// 按“事项＋子任务＋责任人”聚合催办次数，供页面直接展示责任人级计数。
urgeRouter.get('/counts', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    await ensureNotificationIdentityColumns(db);
    const { urgeRecords: urgeTable } = await import('../db/schema');
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canReadUrges(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无催办访问权限' });
    }
    const itemIds = asStringArray(req.query.itemIds);
    if (itemIds.length === 0) return res.json({ byTarget: {}, byItem: {} });

    const { items: itemsTable } = await import('../db/schema');
    const accessibleItems = filterItemsByAccess(
      (await db.select().from(itemsTable).where(inArray(itemsTable.id, itemIds))) as AccessItemLike[],
      accessContext,
    );
    const accessibleIds = new Set(accessibleItems.map((it) => it.id));

    const rows = await db
      .select({
        itemId: urgeTable.itemId,
        subTaskId: urgeTable.subTaskId,
        receiverId: urgeTable.receiverId,
        cnt: sql<number>`count(*)`,
      })
      .from(urgeTable)
      .where(inArray(urgeTable.itemId, [...accessibleIds]))
      .groupBy(urgeTable.itemId, urgeTable.subTaskId, urgeTable.receiverId);

    const byTarget: Record<string, number> = {};
    const byItem: Record<string, number> = {};
    for (const row of rows as Array<{ itemId: string; subTaskId: string | null; receiverId: string | null; cnt: number }>) {
      const key = `${row.itemId}|${row.subTaskId || 'ROOT'}|${row.receiverId || ''}`;
      const count = Number(row.cnt) || 0;
      byTarget[key] = count;
      byItem[row.itemId] = (byItem[row.itemId] || 0) + count;
    }
    return res.json({ byTarget, byItem });
  } catch (error) {
    console.error('Get urge counts error:', error);
    return res.status(500).json({ error: '获取催办计数失败' });
  }
});

// 催办历史（分页 + 筛选），服务端过滤数据权限。
urgeRouter.get('/history', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    await ensureNotificationIdentityColumns(db);
    const { urgeRecords: urgeTable } = await import('../db/schema');
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canReadUrges(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无催办访问权限' });
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

    const conditions: any[] = [];
    if (typeof req.query.itemId === 'string' && req.query.itemId) conditions.push(eq(urgeTable.itemId, req.query.itemId));
    if (typeof req.query.receiverId === 'string' && req.query.receiverId) conditions.push(eq(urgeTable.receiverId, req.query.receiverId));
    if (typeof req.query.senderId === 'string' && req.query.senderId) conditions.push(eq(urgeTable.senderId, req.query.senderId));
    if (typeof req.query.scope === 'string' && req.query.scope) conditions.push(eq(urgeTable.scope, req.query.scope));
    if (typeof req.query.source === 'string' && req.query.source) conditions.push(eq(urgeTable.source, req.query.source));
    if (typeof req.query.method === 'string' && req.query.method) conditions.push(eq(urgeTable.method, req.query.method));
    if (typeof req.query.status === 'string' && req.query.status) conditions.push(eq(urgeTable.status, req.query.status));
    if (typeof req.query.dateFrom === 'string' && req.query.dateFrom) conditions.push(gte(urgeTable.timestamp, new Date(req.query.dateFrom)));
    if (typeof req.query.dateTo === 'string' && req.query.dateTo) conditions.push(lte(urgeTable.timestamp, new Date(req.query.dateTo)));
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      conditions.push(like(urgeTable.itemTitle, `%${req.query.search.trim()}%`));
    }

    const hasGlobal = hasGlobalModuleAccess(accessContext.currentRole);
    if (!hasGlobal) {
      conditions.push(
        sql`(${urgeTable.receiverId} = ${accessContext.currentUser.id} OR ${urgeTable.senderId} = ${accessContext.currentUser.id})`,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const totalRows = await db.select({ c: sql<number>`count(*)` }).from(urgeTable).where(where);
    const total = Number((totalRows[0] as any)?.c) || 0;
    const rows = await db.select().from(urgeTable).where(where).orderBy(desc(urgeTable.timestamp)).limit(pageSize).offset((page - 1) * pageSize);

    return res.json({ rows, total, page, pageSize });
  } catch (error) {
    console.error('Get urge history error:', error);
    return res.status(500).json({ error: '获取催办历史失败' });
  }
});

// 催办统计：按范围/来源/方式/状态聚合，并区分已读未读已反馈。
urgeRouter.get('/stats', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    await ensureNotificationIdentityColumns(db);
    const { urgeRecords: urgeTable } = await import('../db/schema');
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canReadUrges(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无催办访问权限' });
    }

    const conditions: any[] = [];
    if (typeof req.query.itemId === 'string' && req.query.itemId) conditions.push(eq(urgeTable.itemId, req.query.itemId));
    if (typeof req.query.scope === 'string' && req.query.scope) conditions.push(eq(urgeTable.scope, req.query.scope));
    if (typeof req.query.source === 'string' && req.query.source) conditions.push(eq(urgeTable.source, req.query.source));
    if (typeof req.query.method === 'string' && req.query.method) conditions.push(eq(urgeTable.method, req.query.method));
    if (typeof req.query.dateFrom === 'string' && req.query.dateFrom) conditions.push(gte(urgeTable.timestamp, new Date(req.query.dateFrom)));
    if (typeof req.query.dateTo === 'string' && req.query.dateTo) conditions.push(lte(urgeTable.timestamp, new Date(req.query.dateTo)));
    const hasGlobal = hasGlobalModuleAccess(accessContext.currentRole);
    if (!hasGlobal) {
      conditions.push(
        sql`(${urgeTable.receiverId} = ${accessContext.currentUser.id} OR ${urgeTable.senderId} = ${accessContext.currentUser.id})`,
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const grouped = await db
      .select({
        scope: urgeTable.scope,
        source: urgeTable.source,
        method: urgeTable.method,
        status: urgeTable.status,
        cnt: sql<number>`count(*)`,
      })
      .from(urgeTable)
      .where(where)
      .groupBy(urgeTable.scope, urgeTable.source, urgeTable.method, urgeTable.status);

    const byScope: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const byMethod: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let total = 0;
    let responded = 0;
    let read = 0;
    let unread = 0;
    for (const row of grouped as Array<{ scope: string; source: string; method: string; status: string; cnt: number }>) {
      const c = Number(row.cnt) || 0;
      total += c;
      byScope[row.scope] = (byScope[row.scope] || 0) + c;
      bySource[row.source] = (bySource[row.source] || 0) + c;
      byMethod[row.method] = (byMethod[row.method] || 0) + c;
      byStatus[row.status] = (byStatus[row.status] || 0) + c;
      if (row.status === 'RESPONDED') responded += c;
      if (row.status === 'READ') read += c;
      if (row.status === 'UNREAD') unread += c;
    }

    const distinctRows = await db
      .select({
        items: sql<number>`count(distinct ${urgeTable.itemId})`,
        receivers: sql<number>`count(distinct ${urgeTable.receiverId})`,
        batches: sql<number>`count(distinct ${urgeTable.batchId})`,
      })
      .from(urgeTable)
      .where(where);
    const distinct = distinctRows[0] as any;

    return res.json({
      total,
      responded,
      read,
      unread,
      byScope,
      bySource,
      byMethod,
      byStatus,
      distinctItems: Number(distinct?.items) || 0,
      distinctReceivers: Number(distinct?.receivers) || 0,
      distinctBatches: Number(distinct?.batches) || 0,
    });
  } catch (error) {
    console.error('Get urge stats error:', error);
    return res.status(500).json({ error: '获取催办统计失败' });
  }
});

// 催办统计看板：聚合排行、趋势与分布，供可视化看板使用。复用 stats 的数据权限与筛选条件。
urgeRouter.get('/dashboard', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    await ensureNotificationIdentityColumns(db);
    const { urgeRecords: urgeTable, users: usersTable } = await import('../db/schema');
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canReadUrges(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无催办访问权限' });
    }

    const conditions: any[] = [];
    if (typeof req.query.itemId === 'string' && req.query.itemId) conditions.push(eq(urgeTable.itemId, req.query.itemId));
    if (typeof req.query.scope === 'string' && req.query.scope) conditions.push(eq(urgeTable.scope, req.query.scope));
    if (typeof req.query.source === 'string' && req.query.source) conditions.push(eq(urgeTable.source, req.query.source));
    if (typeof req.query.method === 'string' && req.query.method) conditions.push(eq(urgeTable.method, req.query.method));
    if (typeof req.query.dateFrom === 'string' && req.query.dateFrom) conditions.push(gte(urgeTable.timestamp, new Date(req.query.dateFrom)));
    if (typeof req.query.dateTo === 'string' && req.query.dateTo) conditions.push(lte(urgeTable.timestamp, new Date(req.query.dateTo)));
    const hasGlobal = hasGlobalModuleAccess(accessContext.currentRole);
    if (!hasGlobal) {
      conditions.push(
        sql`(${urgeTable.receiverId} = ${accessContext.currentUser.id} OR ${urgeTable.senderId} = ${accessContext.currentUser.id})`,
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const grouped = await db
      .select({
        scope: urgeTable.scope,
        source: urgeTable.source,
        method: urgeTable.method,
        status: urgeTable.status,
        cnt: sql<number>`count(*)`,
      })
      .from(urgeTable)
      .where(where)
      .groupBy(urgeTable.scope, urgeTable.source, urgeTable.method, urgeTable.status);

    const trend = await db
      .select({
        date: sql<string>`date(${urgeTable.timestamp})`,
        count: sql<number>`count(*)`,
        responded: sql<number>`sum(case when ${urgeTable.status} = 'RESPONDED' then 1 else 0 end)`,
      })
      .from(urgeTable)
      .where(where)
      .groupBy(sql`date(${urgeTable.timestamp})`)
      .orderBy(sql`date(${urgeTable.timestamp})`);

    const topReceivers = await db
      .select({
        receiverId: urgeTable.receiverId,
        receiverName: urgeTable.receiver,
        count: sql<number>`count(*)`,
        responded: sql<number>`sum(case when ${urgeTable.status} = 'RESPONDED' then 1 else 0 end)`,
      })
      .from(urgeTable)
      .where(where)
      .groupBy(urgeTable.receiverId, urgeTable.receiver)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    const topItems = await db
      .select({
        itemId: urgeTable.itemId,
        itemTitle: urgeTable.itemTitle,
        count: sql<number>`count(*)`,
        responded: sql<number>`sum(case when ${urgeTable.status} = 'RESPONDED' then 1 else 0 end)`,
      })
      .from(urgeTable)
      .where(where)
      .groupBy(urgeTable.itemId, urgeTable.itemTitle)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    const topDepartments = await db
      .select({
        deptId: usersTable.deptId,
        count: sql<number>`count(*)`,
      })
      .from(urgeTable)
      .leftJoin(usersTable, eq(urgeTable.receiverId, usersTable.id))
      .where(where)
      .groupBy(usersTable.deptId)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    const distinctRows = await db
      .select({
        items: sql<number>`count(distinct ${urgeTable.itemId})`,
        receivers: sql<number>`count(distinct ${urgeTable.receiverId})`,
        batches: sql<number>`count(distinct ${urgeTable.batchId})`,
      })
      .from(urgeTable)
      .where(where);
    const distinct = distinctRows[0] as any;

    let total = 0;
    let responded = 0;
    let read = 0;
    let unread = 0;
    const byMethod: Record<string, number> = {};
    const byScope: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const row of grouped as Array<{ scope: string; source: string; method: string; status: string; cnt: number }>) {
      const c = Number(row.cnt) || 0;
      total += c;
      byMethod[row.method] = (byMethod[row.method] || 0) + c;
      byScope[row.scope] = (byScope[row.scope] || 0) + c;
      bySource[row.source] = (bySource[row.source] || 0) + c;
      byStatus[row.status] = (byStatus[row.status] || 0) + c;
      if (row.status === 'RESPONDED') responded += c;
      if (row.status === 'READ') read += c;
      if (row.status === 'UNREAD') unread += c;
    }

    return res.json({
      total,
      responded,
      read,
      unread,
      byMethod,
      byScope,
      bySource,
      byStatus,
      distinctItems: Number(distinct?.items) || 0,
      distinctReceivers: Number(distinct?.receivers) || 0,
      distinctBatches: Number(distinct?.batches) || 0,
      trend,
      topReceivers,
      topItems,
      topDepartments,
    });
  } catch (error) {
    console.error('Get urge dashboard error:', error);
    return res.status(500).json({ error: '获取催办看板数据失败' });
  }
});

// 获取催办记录
urgeRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    await ensureNotificationIdentityColumns(db);
    const { urgeRecords: urgeTable } = await import('../db/schema');
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canReadUrges(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无催办访问权限' });
    }
    const records = await db.select().from(urgeTable).orderBy(desc(urgeTable.timestamp));
    if (hasGlobalModuleAccess(accessContext.currentRole)) {
      return res.json(records);
    }
    const visibleRecords = records.filter((record) =>
      isUrgeVisibleToUser(record, { id: accessContext.currentUser.id, name: accessContext.currentUser.name }),
    );
    return res.json(visibleRecords);
  } catch (error) {
    console.error('Get urges error:', error);
    return res.status(500).json({ error: '获取催办记录失败' });
  }
});
