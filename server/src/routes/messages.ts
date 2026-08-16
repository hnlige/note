import { Router, Request, Response } from 'express';
import { and, count, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { AuthenticatedRequest } from './auth.middleware';
import { getCurrentAccessContext } from './access.context';
import {
  canManageMessages,
  canReadMessages,
  getMessageTargetIdentities,
  hasGlobalModuleAccess,
  isMessageVisibleToUser,
} from './module-authz';
import { ensureNotificationIdentityColumns } from './notification.schema';
import { getLinkedItemIds } from './messages.policy';
import { buildPagination, getPageRequest } from './pagination';

export const messagesRouter = Router();

function normalizeMessageContent(content: unknown): string {
  if (typeof content !== 'string') return '';
  return content.replace(/催办：undefined\s*$/u, '催办：请及时查看并反馈处理进展。');
}

function normalizeMessage<T extends { content?: unknown }>(message: T): T {
  return {
    ...message,
    content: normalizeMessageContent(message.content),
  };
}

// 获取当前用户的消息
messagesRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    await ensureNotificationIdentityColumns(db);
    const { messages: messagesTable, messageUserStates } = await import('../db/schema');
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canReadMessages(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无消息访问权限' });
    }

    const page = getPageRequest(req.query as Record<string, unknown>);
    const stateJoin = and(
      eq(messageUserStates.messageId, messagesTable.id),
      eq(messageUserStates.userId, accessContext.currentUser.id),
    );
    // `receiver_name` is retained only for historical rows that predate receiver_id.
    const recipientWhere = hasGlobalModuleAccess(accessContext.currentRole)
      ? undefined
      : or(
        and(isNull(messagesTable.receiverId), isNull(messagesTable.receiverName)),
        eq(messagesTable.receiverId, accessContext.currentUser.id),
        and(isNull(messagesTable.receiverId), eq(messagesTable.receiverName, accessContext.currentUser.name)),
      );
    const visibleWhere = and(
      recipientWhere,
      or(isNull(messageUserStates.deleted), eq(messageUserStates.deleted, false)),
      // Preserve the old contract: only exact /items/:id links are hidden after their item is deleted.
      sql`(${messagesTable.link} IS NULL OR ${messagesTable.link} NOT REGEXP '^/items/[^/?#]+$' OR EXISTS (SELECT 1 FROM items WHERE items.id = SUBSTRING(${messagesTable.link}, 8)))`,
    );
    const [{ total }] = await db.select({ total: count() })
      .from(messagesTable)
      .leftJoin(messageUserStates, stateJoin)
      .where(visibleWhere);
    const rows = await db.select({ message: messagesTable, read: messageUserStates.read })
      .from(messagesTable)
      .leftJoin(messageUserStates, stateJoin)
      .where(visibleWhere)
      .orderBy(desc(messagesTable.timestamp), desc(messagesTable.id))
      .limit(page.pageSize)
      .offset((page.page - 1) * page.pageSize);
    const data = rows.map((row) => normalizeMessage({ ...row.message, read: row.read || false }));

    return res.json({ data, pagination: buildPagination(page, Number(total || 0)) });
  } catch (error) {
    console.error('Get messages error:', error);
    return res.status(500).json({ error: '获取消息失败' });
  }
});

// 标记已读
messagesRouter.put('/:id/read', async (req: AuthenticatedRequest & Request<{ id: string }>, res: Response) => {
  try {
    const db = await getDb();
    await ensureNotificationIdentityColumns(db);
    const { messages: messagesTable, messageUserStates } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canManageMessages(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无消息操作权限' });
    }

    const [message] = await db.select().from(messagesTable).where(eq(messagesTable.id, req.params.id as string)).limit(1);
    if (!message) {
      return res.status(404).json({ error: '消息不存在' });
    }
    if (
      !hasGlobalModuleAccess(accessContext.currentRole) &&
      !isMessageVisibleToUser(message, { id: accessContext.currentUser.id, name: accessContext.currentUser.name })
    ) {
      return res.status(403).json({ error: '当前账号无权操作该消息' });
    }

    await db.insert(messageUserStates).values({
      messageId: message.id,
      userId: accessContext.currentUser.id,
      read: true,
      deleted: false,
      updatedAt: new Date(),
    } as any).onDuplicateKeyUpdate({ set: { read: true, deleted: false, updatedAt: new Date() } as any });

    return res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    return res.status(500).json({ error: '标记已读失败' });
  }
});

// 批量删除已读消息 (必须放在 /:id 前面，否则 Express 可能用 /:id 匹配 /)
messagesRouter.delete('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    await ensureNotificationIdentityColumns(db);
    const { messages: messagesTable, messageUserStates } = await import('../db/schema');
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canManageMessages(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无消息操作权限' });
    }

    const type = (req.query.type as string) || 'READ';
    const msgs = await db.select().from(messagesTable).orderBy(messagesTable.timestamp);
    const states = await db.select().from(messageUserStates)
      .where((await import('drizzle-orm')).eq(messageUserStates.userId, accessContext.currentUser.id));
    const statesByMessageId = new Map(states.map((state) => [state.messageId, state]));

    let toDelete: typeof msgs;
    if (['TODO', 'URGE', 'NOTICE'].includes(type)) {
      toDelete = msgs.filter(m => statesByMessageId.get(m.id)?.read && !statesByMessageId.get(m.id)?.deleted && m.type === type);
    } else {
      toDelete = msgs.filter(m => statesByMessageId.get(m.id)?.read && !statesByMessageId.get(m.id)?.deleted);
    }

    if (!hasGlobalModuleAccess(accessContext.currentRole!)) {
      toDelete = toDelete.filter(m =>
        isMessageVisibleToUser(m, { id: accessContext!.currentUser.id, name: accessContext!.currentUser.name })
      );
    }

    if (toDelete.length === 0) {
      return res.json({ success: true, deletedCount: 0 });
    }

    const idsToDelete = toDelete.map(m => m.id);
    const BATCH_SIZE = 100;
    for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
      const batch = idsToDelete.slice(i, i + BATCH_SIZE);
      await db.insert(messageUserStates).values(batch.map((messageId) => ({
        messageId,
        userId: accessContext.currentUser.id,
        read: true,
        deleted: true,
        updatedAt: new Date(),
      })) as any).onDuplicateKeyUpdate({ set: { read: true, deleted: true, updatedAt: new Date() } as any });
    }

    return res.json({ success: true, deletedCount: idsToDelete.length });
  } catch (error) {
    console.error('Batch delete messages error:', error);
    return res.status(500).json({ error: '批量删除消息失败' });
  }
});

// 删除单条消息
messagesRouter.delete('/:id', async (req: AuthenticatedRequest & Request<{ id: string }>, res: Response) => {
  try {
    const db = await getDb();
    const { messages: messagesTable, messageUserStates } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canManageMessages(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无消息操作权限' });
    }

    const [message] = await db.select().from(messagesTable).where(eq(messagesTable.id, req.params.id as string)).limit(1);
    if (!message) {
      return res.status(404).json({ error: '消息不存在' });
    }
    if (
      !hasGlobalModuleAccess(accessContext.currentRole) &&
      !isMessageVisibleToUser(message, { id: accessContext.currentUser.id, name: accessContext.currentUser.name })
    ) {
      return res.status(403).json({ error: '当前账号无权操作该消息' });
    }

    await db.insert(messageUserStates).values({
      messageId: message.id,
      userId: accessContext.currentUser.id,
      read: true,
      deleted: true,
      updatedAt: new Date(),
    } as any).onDuplicateKeyUpdate({ set: { read: true, deleted: true, updatedAt: new Date() } as any });
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete message error:', error);
    return res.status(500).json({ error: '删除消息失败' });
  }
});

// 创建消息
messagesRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    await ensureNotificationIdentityColumns(db);
    const { items: itemsTable, messages: messagesTable, users: usersTable } = await import('../db/schema');
    const { v4: uuid } = await import('uuid');
    const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
    if (!accessContext?.currentRole || !canManageMessages(accessContext.currentRole)) {
      return res.status(403).json({ error: '当前账号无消息操作权限' });
    }

    const { id: clientId, title, content, type, link, receiverId, receiverName, senderId, senderName } = req.body;
    const linkedItemId = getLinkedItemIds([{ link }])[0];
    if (linkedItemId) {
      const { eq } = await import('drizzle-orm');
      const [item] = await db.select({ id: itemsTable.id }).from(itemsTable).where(eq(itemsTable.id, linkedItemId)).limit(1);
      if (!item) {
        return res.status(400).json({ error: '消息关联事项不存在' });
      }
    }
    const users = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      username: usersTable.username,
    }).from(usersTable);
    const identities = getMessageTargetIdentities(
      {
        receiverId: receiverId || null,
        receiverName: receiverName || null,
        senderId: senderId || accessContext.currentUser.id,
        senderName: senderName || accessContext.currentUser.name || null,
      },
      users,
    );
    const newMessage = {
      id: clientId || uuid(),
      title: title || '',
      content: content || '',
      type: type || 'NOTICE',
      timestamp: new Date(),
      link: link || null,
      receiverId: identities.receiverId || null,
      receiverName: identities.receiverName || null,
      senderId: identities.senderId || null,
      senderName: identities.senderName || accessContext.currentUser.name || null,
    };
    await db.insert(messagesTable).values(newMessage as never);

    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('Create message error:', error);
    return res.status(500).json({ error: '创建消息失败' });
  }
});
