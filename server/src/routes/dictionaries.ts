import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { canManageDictionaries, canReadDictionaries } from './module-authz';
import { requireModuleAccess } from './module-authz.middleware';
import { validateDictionaryPayload } from './validation';

export const dictionariesRouter = Router();
const requireDictionaryRead = requireModuleAccess(canReadDictionaries, '当前账号无字典访问权限');
const requireDictionaryManage = requireModuleAccess(canManageDictionaries, '当前账号无字典管理权限');

dictionariesRouter.get('/', requireDictionaryRead, async (_req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { dictionaries: dictTable } = await import('../db/schema');
    const all = await db.select().from(dictTable).orderBy(dictTable.sortOrder);
    return res.json(all);
  } catch (error) {
    console.error('Get dictionaries error:', error);
    return res.status(500).json({ error: '获取字典列表失败' });
  }
});

dictionariesRouter.post('/', requireDictionaryManage, async (req: Request, res: Response) => {
  const validation = validateDictionaryPayload(req.body, 'create');
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const db = await getDb();
    const { dictionaries: dictTable } = await import('../db/schema');
    const { id: clientId, type, label, value, sortOrder } = req.body;
    const { v4: uuid } = await import('uuid');
    await db.insert(dictTable).values({
      id: clientId || uuid(),
      type,
      label,
      value,
      sortOrder: sortOrder || 0,
    } as any);
    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('Create dictionary error:', error);
    return res.status(500).json({ error: '新增字典失败' });
  }
});

dictionariesRouter.put('/:id', requireDictionaryManage, async (req: Request<{ id: string }>, res: Response) => {
  const validation = validateDictionaryPayload(req.body, 'update');
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const db = await getDb();
    const { dictionaries: dictTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const { type, label, value, sortOrder } = req.body;
    const updates: any = {};
    if (type !== undefined) updates.type = type;
    if (label !== undefined) updates.label = label;
    if (value !== undefined) updates.value = value;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    if (Object.keys(updates).length > 0) {
      await db.update(dictTable).set(updates).where(eq(dictTable.id, req.params.id));
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Update dictionary error:', error);
    return res.status(500).json({ error: '更新字典失败' });
  }
});

dictionariesRouter.delete('/:id', requireDictionaryManage, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const db = await getDb();
    const { dictionaries: dictTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    await db.delete(dictTable).where(eq(dictTable.id, req.params.id));
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete dictionary error:', error);
    return res.status(500).json({ error: '删除字典失败' });
  }
});
