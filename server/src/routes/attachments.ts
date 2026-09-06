import express, { Router, Response } from 'express';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { AuthenticatedRequest } from './auth.middleware';
import { getCurrentAccessContext } from './access.context';
import { filterItemsByAccess } from './access.policy';
import { canUseItemAction } from './items.policy';
import { getItemIdentityBackfill } from './items.backfill';
import { ensureAttachmentUploadActorAllowed, normalizeItemJsonFields, resolveItemPageAuth } from './items';
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
  // raw 层留少量余量（52mb），精确的 50MB 业务上限由 getMaxAttachmentBytes 判定并返回明确错误。
  express.raw({ type: '*/*', limit: '52mb' }),
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
      // 线上 items 的 owner_ids/follower_ids 等列是 TEXT，查询返回 JSON 字符串；
      // 列表/详情路由都会先规整字段再做行级过滤，附件路由必须保持同一口径，
      // 否则多责任人事项里非第一责任人的成员会被误判为无权上传。
      const normalizedItem = normalizeItemJsonFields(item as any);
      // 与事项列表/详情保持一致：历史数据可能只有责任人姓名，先以内存方式补齐身份再做行级权限判断。
      const identityBackfill = getItemIdentityBackfill(normalizedItem, accessContext.users as any);
      const permissionItem = identityBackfill ? { ...normalizedItem, ...identityBackfill } : normalizedItem;
      if (filterItemsByAccess([permissionItem] as any, accessContext).length === 0) {
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
      if (!ensureAttachmentUploadActorAllowed(accessContext, permissionItem as any, res)) return;

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
