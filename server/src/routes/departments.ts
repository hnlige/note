import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import type { InferInsertModel } from 'drizzle-orm';
import { departments } from '../db/schema';
import { canManageDepartments, canReadDepartments } from './module-authz';
import { requireModuleAccess } from './module-authz.middleware';
import { invalidateAccessContextCache } from './access.context';

export const departmentsRouter = Router();
const requireDepartmentRead = requireModuleAccess(canReadDepartments, '当前账号无组织架构访问权限');
const requireDepartmentManage = requireModuleAccess(canManageDepartments, '当前账号无组织架构管理权限');

// 获取部门树
departmentsRouter.get('/', requireDepartmentRead, async (_req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { departments: deptTable } = await import('../db/schema');
    const all = await db.select().from(deptTable).orderBy(deptTable.sortOrder);
    const buildTree = (parentId: string | null): any[] => {
      const children = all.filter(d => d.parentId === parentId);
      return children.map(d => ({
        id: d.id,
        name: d.name,
        type: d.type || 'DEPARTMENT',
        sortOrder: d.sortOrder,
        children: buildTree(d.id),
      }));
    };
    const tree = buildTree(null);
    return res.json(tree);
  } catch (error) {
    console.error('Get departments error:', error);
    return res.status(500).json({ error: '获取部门列表失败' });
  }
});

// 获取扁平部门列表
departmentsRouter.get('/flat', requireDepartmentRead, async (_req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { departments: deptTable } = await import('../db/schema');
    const all = await db.select().from(deptTable).orderBy(deptTable.sortOrder);
    return res.json(all);
  } catch (error) {
    console.error('Get flat departments error:', error);
    return res.status(500).json({ error: '获取部门列表失败' });
  }
});

// 新增部门
departmentsRouter.post('/', requireDepartmentManage, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { departments: deptTable } = await import('../db/schema');
    const { v4: uuid } = await import('uuid');
    const { eq, isNull } = await import('drizzle-orm');

    const { id: clientId, name, parentId, type } = req.body;
    const parentIdValue: string | null = parentId === '__TOP__' || !parentId ? null : parentId;

    // 计算同级最大排序号
    const siblings = parentIdValue === null
      ? await db.select().from(deptTable).where(isNull(deptTable.parentId))
      : await db.select().from(deptTable).where(eq(deptTable.parentId, parentIdValue));
    const maxSort = siblings.reduce((max, s) => Math.max(max, s.sortOrder || 0), 0);

    // 使用前端传入的 ID 或自动生成
    const deptId = clientId || uuid();

    await db.insert(deptTable).values({
      id: deptId,
      name,
      parentId: parentIdValue,
      type: type || 'DEPARTMENT',
      sortOrder: maxSort + 1,
    } as any);
    invalidateAccessContextCache();

    return res.status(201).json({ id: deptId });
  } catch (error) {
    console.error('Create department error:', error);
    return res.status(500).json({ error: '新增部门失败' });
  }
});

// 更新部门
departmentsRouter.put('/:id', requireDepartmentManage, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const db = await getDb();
    const { departments: deptTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const { name } = req.body;
    await db
      .update(deptTable)
      .set({ name })
      .where(eq(deptTable.id, req.params.id));
    invalidateAccessContextCache();
    return res.json({ success: true });
  } catch (error) {
    console.error('Update department error:', error);
    return res.status(500).json({ error: '更新部门失败' });
  }
});

// 删除部门
departmentsRouter.delete('/:id', requireDepartmentManage, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const db = await getDb();
    const { departments: deptTable, users: usersTable } = await import('../db/schema');
    const { eq, count } = await import('drizzle-orm');
    const id = req.params.id;

    const [children] = await db
      .select({ c: count() })
      .from(deptTable)
      .where(eq(deptTable.parentId, id));
    if (children.c > 0) {
      return res.status(400).json({ error: '该部门下还有子部门，无法删除' });
    }

    const [userResult] = await db
      .select({ c: count() })
      .from(usersTable)
      .where(eq(usersTable.deptId, id));
    if (userResult.c > 0) {
      return res.status(400).json({ error: '该部门下还有成员，无法删除' });
    }

    await db.delete(deptTable).where(eq(deptTable.id, id));
    invalidateAccessContextCache();
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete department error:', error);
    return res.status(500).json({ error: '删除部门失败' });
  }
});
