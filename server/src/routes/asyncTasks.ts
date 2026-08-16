import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { canManageAsyncTasks, canReadAsyncTasks } from './module-authz';
import { requireModuleAccess } from './module-authz.middleware';

export const asyncTasksRouter = Router();
const requireAsyncTaskRead = requireModuleAccess(canReadAsyncTasks, '当前账号无任务监控访问权限');
const requireAsyncTaskManage = requireModuleAccess(canManageAsyncTasks, '当前账号无任务监控管理权限');

asyncTasksRouter.get('/', requireAsyncTaskRead, async (_req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { asyncTasks: taskTable } = await import('../db/schema');
    const all = await db.select().from(taskTable).orderBy(taskTable.startTime);
    return res.json(all);
  } catch (error) {
    console.error('Get async tasks error:', error);
    return res.status(500).json({ error: '获取异步任务列表失败' });
  }
});

asyncTasksRouter.post('/', requireAsyncTaskManage, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { asyncTasks: taskTable } = await import('../db/schema');
    const { id: clientId, name, module, status, progress, result } = req.body;
    const { v4: uuid } = await import('uuid');
    await db.insert(taskTable).values({
      id: clientId || uuid(),
      name,
      module: module || '',
      status: status || 'PROCESSING',
      progress: progress || 0,
      result: result || '',
    } as any);
    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('Create async task error:', error);
    return res.status(500).json({ error: '创建异步任务失败' });
  }
});

asyncTasksRouter.put('/:id', requireAsyncTaskManage, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const db = await getDb();
    const { asyncTasks: taskTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const updates: any = { ...req.body };
    delete updates.id;
    if (updates.status && (updates.status === 'COMPLETED' || updates.status === 'FAILED')) {
      updates.endTime = new Date();
    }
    if (Object.keys(updates).length > 0) {
      await db.update(taskTable).set(updates).where(eq(taskTable.id, req.params.id));
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Update async task error:', error);
    return res.status(500).json({ error: '更新异步任务失败' });
  }
});
