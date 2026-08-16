import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { canManageAudit, canReadAudit } from './module-authz';
import { requireModuleAccess } from './module-authz.middleware';
import { count, desc } from 'drizzle-orm';
import { buildPagination, getPageRequest } from './pagination';

export const auditRouter = Router();
const requireAuditRead = requireModuleAccess(canReadAudit, '当前账号无审核访问权限');
const requireAuditManage = requireModuleAccess(canManageAudit, '当前账号无审核操作权限');

export function toAuditRecordDto(record: Record<string, any>) {
  return {
    id: record.id,
    itemId: record.itemId || '',
    itemTitle: record.itemTitle || '',
    submitter: record.applicantName || '',
    submitTime: record.submittedAt instanceof Date ? record.submittedAt.toISOString() : String(record.submittedAt || ''),
    content: record.comment || '',
    status: record.status,
    reviewerName: record.reviewerName || undefined,
    reviewedAt: record.reviewedAt instanceof Date ? record.reviewedAt.toISOString() : record.reviewedAt || undefined,
    rating: record.rating ?? undefined,
    evaluation: record.evaluation || undefined,
  };
}

auditRouter.get('/', requireAuditRead, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { auditRecords: auditTable } = await import('../db/schema');
    const page = getPageRequest(req.query as Record<string, unknown>);
    const [{ total }] = await db.select({ total: count() }).from(auditTable);
    const rows = await db.select().from(auditTable)
      .orderBy(desc(auditTable.submittedAt), desc(auditTable.id))
      .limit(page.pageSize)
      .offset((page.page - 1) * page.pageSize);
    return res.json({ data: rows.map(toAuditRecordDto), pagination: buildPagination(page, Number(total || 0)) });
  } catch (error) {
    console.error('Get audit records error:', error);
    return res.status(500).json({ error: '获取审核记录失败' });
  }
});

auditRouter.post('/', requireAuditManage, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { auditRecords: auditTable } = await import('../db/schema');
    const { id: clientId, itemId, itemTitle, applicantName, reviewerName, status, result, comment } = req.body;
    const { v4: uuid } = await import('uuid');
    await db.insert(auditTable).values({
      id: clientId || uuid(),
      itemId: itemId || null,
      itemTitle: itemTitle || '',
      applicantName: applicantName || '',
      reviewerName: reviewerName || null,
      status: status || 'PENDING',
      result: result || null,
      comment: comment || '',
    } as any);
    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('Create audit record error:', error);
    return res.status(500).json({ error: '创建审核记录失败' });
  }
});

auditRouter.put('/:id', requireAuditManage, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const db = await getDb();
    const { auditRecords: auditTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const updates: any = { ...req.body };
    delete updates.id;
    if (updates.status && (updates.status === 'APPROVED' || updates.status === 'REJECTED')) {
      updates.reviewedAt = new Date();
    }
    if (Object.keys(updates).length > 0) {
      await db.update(auditTable).set(updates).where(eq(auditTable.id, req.params.id));
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Update audit record error:', error);
    return res.status(500).json({ error: '更新审核记录失败' });
  }
});
