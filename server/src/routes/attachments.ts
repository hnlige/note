import express, { Router, Response } from 'express';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { AuthenticatedRequest } from './auth.middleware';
import { getCurrentAccessContext } from './access.context';
import { filterItemsByAccess } from './access.policy';
import { canUseItemAction } from './items.policy';
import { ensureItemActorAllowed, resolveItemPageAuth } from './items';
import { getMaxAttachmentBytes, resolveAttachmentUrl, sanitizeAttachmentName, uploadAttachment } from '../storage/cos';

export const attachmentsRouter = Router();

function getHeaderValue(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

function parseFileName(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded && decoded.length <= 512 ? sanitizeAttachmentName(decoded) : null;
  } catch {
    return null;
  }
}

attachmentsRouter.post(
  '/items/:itemId',
  express.raw({ type: '*/*', limit: '25mb' }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.authUser?.id) return res.status(401).json({ error: '请先登录' });
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: '附件内容不能为空' });
      if (req.body.length > getMaxAttachmentBytes()) return res.status(413).json({ error: '附件超过大小限制' });

      const fileName = parseFileName(getHeaderValue(req.headers['x-duban-file-name']));
      if (!fileName) return res.status(400).json({ error: '附件文件名无效' });
      const pageAuth = resolveItemPageAuth(req.headers['x-page-auth']);
      if (pageAuth === null) return res.status(400).json({ error: '页面权限上下文无效' });

      const itemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
      if (!itemId) return res.status(400).json({ error: '事项 ID 无效' });

      const db = await getDb();
      const { items } = await import('../db/schema');
      const [item] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
      if (!item) return res.status(404).json({ error: '事项不存在' });

      const accessContext = await getCurrentAccessContext(db, req.authUser.id);
      if (!accessContext?.currentUser || !accessContext.currentRole) {
        return res.status(403).json({ error: '当前账号角色配置异常，请联系管理员' });
      }
      if (filterItemsByAccess([item] as any, accessContext).length === 0) {
        return res.status(403).json({ error: '当前账号无权上传该事项附件' });
      }
      if (!canUseItemAction({
        role: accessContext.currentUser.role,
        roleConfig: accessContext.currentRole,
        pageAuth: pageAuth || undefined,
        action: 'FEEDBACK_ITEM',
      })) {
        return res.status(403).json({ error: '当前角色无上传附件权限' });
      }
      if (!ensureItemActorAllowed(accessContext, 'FEEDBACK_ITEM', item as any, res)) return;

      const attachment = await uploadAttachment({
        itemId: item.id,
        fileName,
        contentType: getHeaderValue(req.headers['x-duban-file-type']) || 'application/octet-stream',
        body: req.body,
      });
      return res.status(201).json(resolveAttachmentUrl(attachment));
    } catch (error) {
      console.error('Upload attachment error:', error);
      return res.status(500).json({ error: '附件上传失败' });
    }
  },
);
