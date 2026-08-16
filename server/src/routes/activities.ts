import { Router, Request, Response } from 'express';
import { count, desc } from 'drizzle-orm';
import { getDb } from '../db';
import { canManageActivities, canReadActivities } from './module-authz';
import { requireModuleAccess } from './module-authz.middleware';
import { buildPagination, getPageRequest } from './pagination';

export const activitiesRouter = Router();
const requireActivityRead = requireModuleAccess(canReadActivities, '当前账号无动态访问权限');
const requireActivityManage = requireModuleAccess(canManageActivities, '当前账号无动态管理权限');

activitiesRouter.get('/', requireActivityRead, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { activities } = await import('../db/schema');
    const page = getPageRequest(req.query as Record<string, unknown>);
    const [{ total }] = await db.select({ total: count() }).from(activities);
    const rows = await db.select().from(activities)
      .orderBy(desc(activities.timestamp), desc(activities.id))
      .limit(page.pageSize)
      .offset((page.page - 1) * page.pageSize);
    return res.json({ data: rows, pagination: buildPagination(page, Number(total || 0)) });
  } catch (error) {
    console.error('Get activities error:', error);
    return res.status(500).json({ error: '获取动态失败' });
  }
});

activitiesRouter.post('/', requireActivityManage, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { activities } = await import('../db/schema');
    const { v4: uuid } = await import('uuid');

    const { id: clientId, content, type } = req.body;
    await db.insert(activities).values({
      id: clientId || uuid(),
      content: content || '',
      type: type || 'SYSTEM',
      timestamp: new Date(),
    } as any);

    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('Create activity error:', error);
    return res.status(500).json({ error: '创建动态失败' });
  }
});
