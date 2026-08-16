import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { canManageTemplates, canReadTemplates } from './module-authz';
import { requireModuleAccess } from './module-authz.middleware';
import { validateTemplatePayload } from './validation';

export const templatesRouter = Router();
const requireTemplateRead = requireModuleAccess(canReadTemplates, '当前账号无模板访问权限');
const requireTemplateManage = requireModuleAccess(canManageTemplates, '当前账号无模板管理权限');

templatesRouter.get('/', requireTemplateRead, async (_req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { templates: templatesTable } = await import('../db/schema');
    const all = await db.select().from(templatesTable);
    return res.json(all);
  } catch (error) {
    console.error('Get templates error:', error);
    return res.status(500).json({ error: '获取模板列表失败' });
  }
});

templatesRouter.post('/', requireTemplateManage, async (req: Request, res: Response) => {
  const validation = validateTemplatePayload(req.body, 'create');
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const db = await getDb();
    const { templates: templatesTable } = await import('../db/schema');
    const { id: clientId, name, content, category, description, defaultDeadlineDays, defaultFollowerId, defaultFollowerName, rules, status } = req.body;
    const { v4: uuid } = await import('uuid');
    await db.insert(templatesTable).values({
      id: clientId || uuid(),
      name,
      content: content || '',
      category: category || '',
      description: description || '',
      defaultDeadlineDays: defaultDeadlineDays ?? 7,
      defaultFollowerId: defaultFollowerId || null,
      defaultFollowerName: defaultFollowerName || null,
      rules: rules || {},
      status: status || 'DRAFT',
    } as any);
    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('Create template error:', error);
    return res.status(500).json({ error: '新增模板失败' });
  }
});

templatesRouter.put('/:id', requireTemplateManage, async (req: Request<{ id: string }>, res: Response) => {
  const validation = validateTemplatePayload(req.body, 'update');
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const db = await getDb();
    const { templates: templatesTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const { name, content, category, description, defaultDeadlineDays, defaultFollowerId, defaultFollowerName, rules, status } = req.body;
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (content !== undefined) updates.content = content;
    if (category !== undefined) updates.category = category;
    if (description !== undefined) updates.description = description;
    if (defaultDeadlineDays !== undefined) updates.defaultDeadlineDays = defaultDeadlineDays;
    if (defaultFollowerId !== undefined) updates.defaultFollowerId = defaultFollowerId || null;
    if (defaultFollowerName !== undefined) updates.defaultFollowerName = defaultFollowerName || null;
    if (rules !== undefined) updates.rules = rules;
    if (status !== undefined) updates.status = status;
    if (Object.keys(updates).length > 0) {
      await db.update(templatesTable).set(updates).where(eq(templatesTable.id, req.params.id));
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Update template error:', error);
    return res.status(500).json({ error: '更新模板失败' });
  }
});

templatesRouter.delete('/:id', requireTemplateManage, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const db = await getDb();
    const { templates: templatesTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    await db.delete(templatesTable).where(eq(templatesTable.id, req.params.id));
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete template error:', error);
    return res.status(500).json({ error: '删除模板失败' });
  }
});
