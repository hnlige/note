import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { canManageLights, canReadLights } from './module-authz';
import { requireModuleAccess } from './module-authz.middleware';

export const lightRouter = Router();
const requireLightRead = requireModuleAccess(canReadLights, '当前账号无亮灯访问权限');
const requireLightManage = requireModuleAccess(canManageLights, '当前账号无亮灯管理权限');

lightRouter.get('/', requireLightRead, async (_req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { lightRecords } = await import('../db/schema');
    const all = await db.select().from(lightRecords).orderBy(lightRecords.createdAt);
    return res.json(all);
  } catch (error) {
    console.error('Get light records error:', error);
    return res.status(500).json({ error: '获取亮灯记录失败' });
  }
});

// items.lightStatus 是当前亮灯状态的唯一来源；lightRecords 仅保留不可变审计历史。
lightRouter.post('/', requireLightManage, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { lightRecords, items: itemsTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const { v4: uuid } = await import('uuid');
    const { id: clientId, itemId, color, reason, triggerMode, operatorName } = req.body || {};
    if (typeof itemId !== 'string' || !itemId || !['RED', 'YELLOW'].includes(color)) {
      return res.status(400).json({ error: '亮灯事项和灯色必须有效' });
    }

    const now = new Date();
    await db.transaction(async (tx: any) => {
      const [item] = await tx.select({ id: itemsTable.id }).from(itemsTable).where(eq(itemsTable.id, itemId)).limit(1).for('update');
      if (!item) throw new Error('事项不存在');
      await tx.insert(lightRecords).values({
        id: typeof clientId === 'string' && clientId ? clientId : uuid(),
        itemId,
        color,
        reason: typeof reason === 'string' ? reason : '',
        triggerMode: triggerMode === 'AUTO' ? 'AUTO' : 'MANUAL',
        operatorName: typeof operatorName === 'string' && operatorName ? operatorName : '系统',
        createdAt: now,
      } as any);
      await tx.update(itemsTable).set({ lightStatus: color, updatedAt: now } as any).where(eq(itemsTable.id, itemId));
    });

    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('Create light record error:', error);
    return res.status(500).json({ error: '创建亮灯记录失败' });
  }
});

// 清灯不删除审计历史：当前状态回归 null，并追加 GREEN（解除）事件。
lightRouter.delete('/item/:itemId', requireLightManage, async (req: Request<{ itemId: string }>, res: Response) => {
  try {
    const db = await getDb();
    const { lightRecords, items: itemsTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const { v4: uuid } = await import('uuid');
    const now = new Date();
    await db.transaction(async (tx: any) => {
      const [item] = await tx.select({ id: itemsTable.id }).from(itemsTable).where(eq(itemsTable.id, req.params.itemId)).limit(1).for('update');
      if (!item) throw new Error('事项不存在');
      await tx.update(itemsTable).set({ lightStatus: null, updatedAt: now } as any).where(eq(itemsTable.id, req.params.itemId));
      await tx.insert(lightRecords).values({
        id: uuid(),
        itemId: req.params.itemId,
        color: 'GREEN',
        reason: '人工解除亮灯',
        triggerMode: 'MANUAL',
        operatorName: (req as any).authUser?.name || '系统',
        createdAt: now,
      } as any);
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('Clear light status error:', error);
    return res.status(500).json({ error: '清除亮灯失败' });
  }
});
