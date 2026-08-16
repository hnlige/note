import { Router, type Request, type Response } from 'express';
import { getDb } from '../db';
import { type AuthenticatedRequest } from './auth.middleware';
import { getCurrentAccessContext, invalidateAccessContextCache } from './access.context';
import { getUserRoleKind } from '../lib/item-scope';
import {
  asStringArray,
  computeReassignUpdate,
  detectReassignConflicts,
  matchItems,
  type ReassignScope,
  type ReassignUserLike,
} from './reassign-core';
import { getSignedOwnerNames } from './sign-off';

export const reassignRouter = Router();

function requireAdmin(req: AuthenticatedRequest, res: Response): boolean {
  if (!req.authUser) {
    res.status(401).json({ error: '请先登录' });
    return false;
  }
  return true;
}

async function resolveAdminContext(req: AuthenticatedRequest, res: Response) {
  const db = await getDb();
  const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
  if (!accessContext || !req.authUser || getUserRoleKind(accessContext.currentUser, accessContext.roles) !== 'ADMIN') {
    res.status(403).json({ error: '仅超级管理员可执行督办转交' });
    return null;
  }
  return db;
}

// ── 预览：返回将移交的数量与冲突事项，供前端确认弹窗 ──
reassignRouter.post('/preview', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!requireAdmin(req, res)) return;
    const db = await resolveAdminContext(req, res);
    if (!db) return;

    const { fromUserId, toUserId, scope } = req.body || {};
    if (typeof fromUserId !== 'string' || !fromUserId) return res.status(400).json({ error: '请选择转交来源人员' });
    if (typeof toUserId !== 'string' || !toUserId) return res.status(400).json({ error: '请选择转交目标人员' });
    if (fromUserId === toUserId) return res.status(400).json({ error: '转交来源与目标不能是同一人' });
    if (!['OWNER', 'FOLLOWER', 'ALL'].includes(scope)) return res.status(400).json({ error: '请选择转交范围' });

    const { users: usersTable, items: itemsTable } = await import('../db/schema');
    const { eq, isNull } = await import('drizzle-orm');
    const [fromUser] = await db.select().from(usersTable).where(eq(usersTable.id, fromUserId)).limit(1);
    if (!fromUser) return res.status(404).json({ error: '转交来源人员不存在' });
    const [toUser] = await db.select().from(usersTable).where(eq(usersTable.id, toUserId)).limit(1);
    if (!toUser) return res.status(404).json({ error: '转交目标人员不存在' });
    if (toUser.status !== 'ACTIVE') return res.status(400).json({ error: '转交目标人员账号非活跃状态，无法接收督办' });

    const allItems = await db.select().from(itemsTable).where(isNull(itemsTable.deletedAt));
    const matched = matchItems(allItems, fromUser, scope as ReassignScope);
    const conflicts = detectReassignConflicts(matched, toUser, scope as ReassignScope);
    return res.json({ count: matched.length, conflicts });
  } catch (error) {
    console.error('Reassign preview error:', error);
    return res.status(500).json({ error: '预览失败' });
  }
});

// ── 执行转交：仅超级管理员，事务内原子完成，失败整体回滚 ──
reassignRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!requireAdmin(req, res)) return;
    const db = await resolveAdminContext(req, res);
    if (!db) return;

    const { fromUserId, toUserId, scope, disableSource } = req.body || {};
    if (typeof fromUserId !== 'string' || !fromUserId) return res.status(400).json({ error: '请选择转交来源人员' });
    if (typeof toUserId !== 'string' || !toUserId) return res.status(400).json({ error: '请选择转交目标人员' });
    if (fromUserId === toUserId) return res.status(400).json({ error: '转交来源与目标不能是同一人' });
    if (!['OWNER', 'FOLLOWER', 'ALL'].includes(scope)) return res.status(400).json({ error: '请选择转交范围' });

    const { users: usersTable, items: itemsTable, timelineNodes: timelineTable, messages: messagesTable, operationLogs: logsTable } =
      await import('../db/schema');
    const { eq, isNull } = await import('drizzle-orm');
    const { v4: uuid } = await import('uuid');

    const [fromUser] = await db.select().from(usersTable).where(eq(usersTable.id, fromUserId)).limit(1);
    if (!fromUser) return res.status(404).json({ error: '转交来源人员不存在' });
    const [toUser] = await db.select().from(usersTable).where(eq(usersTable.id, toUserId)).limit(1);
    if (!toUser) return res.status(404).json({ error: '转交目标人员不存在' });
    if (toUser.status !== 'ACTIVE') return res.status(400).json({ error: '转交目标人员账号非活跃状态，无法接收督办' });

    const allItems = await db.select().from(itemsTable).where(isNull(itemsTable.deletedAt));
    const matched = matchItems(allItems, fromUser, scope as ReassignScope);
    if (matched.length === 0) {
      return res.json({ success: true, reassigned: 0, ownerReassignCount: 0, followerReassignCount: 0, itemIds: [], disabledSource: false, message: '该人员当前无匹配的督办事项' });
    }

    const conflicts = detectReassignConflicts(matched, toUser, scope as ReassignScope);
    if (conflicts.length > 0) {
      return res.status(400).json({
        error: `目标人员已是以下事项的${scope === 'FOLLOWER' ? '跟进人' : scope === 'OWNER' ? '责任人' : '责任人或跟进人'}，为保证状态不变已阻断整体移交`,
        conflicts,
      });
    }

    const now = new Date();
    const itemIds: string[] = [];
    const timelineRows: any[] = [];
    const messageRows: any[] = [];
    let ownerReassignCount = 0;
    let followerReassignCount = 0;

    await db.transaction(async (tx: any) => {
      const dbx = tx;
      const { and: andOp, eq: eqOp } = await import('drizzle-orm');
      for (const item of matched) {
        const { update, didOwner, didFollower } = computeReassignUpdate(item, fromUser, toUser, scope as ReassignScope);
        if (Object.keys(update).length === 0) continue;
        if (didOwner) ownerReassignCount += 1;
        if (didFollower) followerReassignCount += 1;
        update.updatedAt = now;
        await dbx.update(itemsTable).set(update).where(eq(itemsTable.id, item.id));
        itemIds.push(item.id);

        const scopeLabel =
          scope === 'ALL' ? '全部' : scope === 'OWNER' ? '责任人' : '跟进人';
        timelineRows.push({
          id: uuid(),
          itemId: item.id,
          type: 'REASSIGN',
          user: req.authUser?.name || '系统',
          content: `督办转交（${scopeLabel}）：${fromUser.name} → ${toUser.name}`,
          timestamp: now,
        });

        // 责任人转交时，若原责任人已签收，则目标责任人继承该签收状态，
        // 避免转交后签收统计从「已签收」跌回「部分签收」。
        if (didOwner) {
          const signNodes = await dbx
            .select()
            .from(timelineTable)
            .where(andOp(eqOp(timelineTable.itemId, item.id), eqOp(timelineTable.type, 'SIGN')));
          const signedOwners = getSignedOwnerNames(signNodes);
          if (signedOwners.has(fromUser.name.trim())) {
            timelineRows.push({
              id: uuid(),
              itemId: item.id,
              type: 'SIGN',
              user: toUser.name,
              content: `由 ${fromUser.name} 转交继承签收状态`,
              timestamp: now,
            });
          }
        }
      }

      if (timelineRows.length > 0) {
        await dbx.insert(timelineTable).values(timelineRows);
      }

      if (itemIds.length > 0) {
        // 给接收人(to)发待办汇总，给来源人(from)发已转交通知
        messageRows.push({
          id: uuid(),
          title: '督办事项转交',
          content: `您已接收 ${fromUser.name} 转交的 ${itemIds.length} 条督办事项，请在工作台查看。`,
          type: 'TODO',
          timestamp: now,
          link: '/workbench',
          receiverId: toUser.id,
          receiverName: toUser.name,
          senderId: req.authUser?.id || null,
          senderName: req.authUser?.name || '系统',
        });
        messageRows.push({
          id: uuid(),
          title: '督办事项已转交',
          content: `您名下的 ${itemIds.length} 条督办事项已转交给 ${toUser.name}。`,
          type: 'NOTICE',
          timestamp: now,
          link: '/workbench',
          receiverId: fromUser.id,
          receiverName: fromUser.name,
          senderId: req.authUser?.id || null,
          senderName: req.authUser?.name || '系统',
        });
        await dbx.insert(messagesTable).values(messageRows);
      }

      // 系统日志（顺手补 operationLogs 表长期无人写入的缺口）
      await dbx.insert(logsTable).values({
        id: uuid(),
        userId: req.authUser?.id || null,
        userName: req.authUser?.name || '系统',
        action: '督办转交',
        module: '员工督办转交',
        detail: JSON.stringify({
          fromUserId: fromUser.id,
          fromUserName: fromUser.name,
          toUserId: toUser.id,
          toUserName: toUser.name,
          scope,
          itemCount: itemIds.length,
          itemIds: itemIds.slice(0, 200),
          disabledSource: Boolean(disableSource),
        }),
        ip: req.ip || 'unknown',
        timestamp: now,
      });

      // 默认勾选：移交同时停用来源账号
      if (disableSource) {
        await dbx.update(usersTable).set({
          status: 'DISABLED',
          sessionVersion: (fromUser.sessionVersion ?? 0) + 1,
        } as any).where(eq(usersTable.id, fromUser.id));
      }
    });

    invalidateAccessContextCache();

    return res.json({
      success: true,
      reassigned: itemIds.length,
      ownerReassignCount,
      followerReassignCount,
      itemIds,
      disabledSource: Boolean(disableSource),
    });
  } catch (error) {
    console.error('Reassign supervision error:', error);
    return res.status(500).json({ error: '督办转交失败，事务已回滚' });
  }
});
