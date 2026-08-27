import { Router, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db';
import { canReadLogs, canWriteOperationLog } from './module-authz';
import { requireModuleAccess } from './module-authz.middleware';
import { AuthenticatedRequest } from './auth.middleware';
import { AuthSessionUser } from './auth.session';
import { getCurrentAccessContext } from './access.context';
import { getPageRequest } from './pagination';

interface OperationLogInput {
  action?: unknown;
  module?: unknown;
  detail?: unknown;
}

interface OperationLogRequestContext {
  body?: OperationLogInput;
  authUser?: AuthSessionUser | null;
  currentUser?: { id?: string; name?: string; username?: string };
  requestIp?: string | null;
  id?: string;
  now?: Date;
}

interface OperationLogValues {
  id: string;
  userId: string;
  userName: string;
  action: string;
  module: string;
  detail: string;
  ip: string;
  timestamp: Date;
}

export function parseOperationLogBody(body: unknown): { action: string; module: string; detail: string } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const input = body as OperationLogInput;
  if (typeof input.action !== 'string') return null;
  const action = input.action.trim();
  if (!action || action.length > 200) return null;
  if (input.module !== undefined && input.module !== null && typeof input.module !== 'string') return null;
  if (input.detail !== undefined && input.detail !== null && typeof input.detail !== 'string') return null;
  const module = typeof input.module === 'string' ? input.module.trim() : '';
  const detail = typeof input.detail === 'string' ? input.detail.trim() : '';
  if (module.length > 50 || detail.length > 10_000) return null;
  return { action, module, detail };
}

export function parseLogLimit(value: unknown): number | null {
  if (value === undefined) return 200;
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value))) return null;
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= 500 ? limit : null;
}

export function buildOperationLogValues(context: OperationLogRequestContext): OperationLogValues | null {
  const authUser = context.authUser;
  if (!authUser?.id) return null;
  const body = parseOperationLogBody(context.body);
  if (!body) return null;
  // 展示用姓名仅在访问上下文与认证会话属于同一用户时才取 users 表；辅助查询
  // 缺失或异常时退回已认证会话。这样既不因辅助字段解析失败丢弃审计记录，
  // 也不会把其他用户的姓名记入当前会话的审计记录。
  const currentUser = context.currentUser?.id === authUser.id ? context.currentUser : null;
  const resolvedName = currentUser?.name || currentUser?.username || authUser.name || authUser.username || String(authUser.id);

  return {
    id: context.id || randomUUID(),
    userId: authUser.id,
    userName: resolvedName,
    action: body.action,
    module: body.module,
    detail: body.detail,
    ip: context.requestIp || 'unknown',
    timestamp: context.now || new Date(),
  };
}

export const logsRouter = Router();
const requireLogRead = requireModuleAccess(canReadLogs, '当前账号无操作日志访问权限');
export const canPostOperationLog = canWriteOperationLog;
const requireLogWrite = requireModuleAccess(canPostOperationLog, '当前账号无操作日志写入权限');

logsRouter.get('/', requireLogRead, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const { operationLogs: logsTable } = await import('../db/schema');
    const { count, desc } = await import('drizzle-orm');
    const limit = parseLogLimit(req.query.limit);
    if (limit === null) return res.status(400).json({ error: '日志条数必须是 1 到 500 的整数' });
    const page = getPageRequest(req.query as Record<string, unknown>, limit, 500);
    const [{ total }] = await db.select({ total: count() }).from(logsTable);
    const rows = await db.select().from(logsTable)
      .orderBy(desc(logsTable.timestamp), desc(logsTable.id))
      .limit(page.pageSize)
      .offset((page.page - 1) * page.pageSize);
    return res.json({ data: rows, pagination: { ...page, total: Number(total || 0), totalPages: Math.ceil(Number(total || 0) / page.pageSize) } });
  } catch (error) {
    console.error('Get logs error:', error);
    return res.status(500).json({ error: '获取操作日志失败' });
  }
});

logsRouter.post('/', requireLogWrite, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.authUser?.id) {
      return res.status(401).json({ error: '请先登录' });
    }

    const db = await getDb();
    const accessContext = await getCurrentAccessContext(db, req.authUser.id);
    const { operationLogs: logsTable } = await import('../db/schema');
    const body = parseOperationLogBody(req.body);
    if (!body) {
      return res.status(400).json({ error: '日志操作、模块或详情格式不正确' });
    }
    const values = buildOperationLogValues({
      body,
      authUser: req.authUser,
      currentUser: accessContext?.currentUser,
      requestIp: req.ip || req.socket.remoteAddress,
    });
    if (!values) {
      return res.status(401).json({ error: '请先登录' });
    }
    await db.insert(logsTable).values(values);
    return res.status(201).json({
      success: true,
      log: { ...values, timestamp: values.timestamp.toISOString() },
    });
  } catch (error) {
    console.error('Create log error:', error);
    return res.status(500).json({ error: '创建操作日志失败' });
  }
});
