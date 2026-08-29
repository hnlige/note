/**
 * 消息 SSE 推送端点（GET /api/messages/stream?token=...）。
 *
 * 背景：桌面端原为每 15s 全量轮询 GET /messages（500 在线用户稳态 33 req/s 且响应大）。
 * SSE 化后：服务端每 MESSAGES_STREAM_INTERVAL_MS（默认 10s）做一次索引点查，
 * 有新消息才推送 messages.changed，客户端据此做一次同步；空闲用户零请求。
 * 兜底：客户端在 SSE 连接期间每 60s 仍全量对账一次（广播消息/已读态自愈），
 * SSE 断开时自动降级回 15s 轮询。
 *
 * 鉴权说明：EventSource 无法携带 Authorization 头，token 经 query 传入，
 * 校验逻辑与 requireAuth 一致（HMAC 签名 + users 状态/sessionVersion 实时核对）。
 */
import { Router, type Request, type Response } from 'express';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '../db';
import { schema } from '../db';
import { parseAuthTokenSession } from './auth.session';

export const messagesStreamRouter = Router();

const TICK_MS = Math.max(3000, Number(process.env.MESSAGES_STREAM_INTERVAL_MS) || 10_000);
const HEARTBEAT_MS = 25_000;

interface StreamAuthUser {
  id: string;
  name: string;
}

/** 与 requireAuth 同口径的鉴权，token 取自 query（EventSource 限制）。失败返回 null。 */
async function authenticateStreamToken(token: unknown): Promise<StreamAuthUser | null> {
  if (typeof token !== 'string' || !token) return null;
  const session = parseAuthTokenSession(token);
  if (!session || session.expired) return null;
  if (!process.env.DATABASE_URL) return session.user; // 与 requireAuth 的无库分支一致（本地纯前端联调）
  const db = await getDb();
  const [row] = await db
    .select({ status: schema.users.status, sessionVersion: schema.users.sessionVersion, id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id))
    .limit(1);
  if (!row || row.status !== 'ACTIVE' || (row.sessionVersion ?? 0) !== (session.user.sessionVersion ?? 0)) return null;
  return { id: row.id, name: row.name };
}

messagesStreamRouter.get('/', async (req: Request, res: Response) => {
  const user = await authenticateStreamToken(req.query.token);
  if (!user) {
    return res.status(401).json({ error: '登录凭证无效' });
  }

  res.status(200).setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // nginx 对该响应关闭缓冲，避免事件被网关攒住不吐
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': connected\n\n');

  const db = await getDb();
  let lastSeen = new Date();
  let closed = false;

  const check = async () => {
    if (closed) return;
    const tickStart = new Date();
    try {
      const rows = await db
        .select({ id: schema.messages.id, timestamp: schema.messages.timestamp })
        .from(schema.messages)
        .where(and(eq(schema.messages.receiverId, user.id), gt(schema.messages.timestamp, lastSeen)))
        .limit(1);
      if (rows.length > 0 && !closed) {
        res.write(`data: ${JSON.stringify({ type: 'messages.changed' })}\n\n`);
      }
      lastSeen = tickStart;
    } catch (error) {
      console.error('[messages-stream] check failed:', error);
    }
  };

  const tick = setInterval(() => void check(), TICK_MS);
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, HEARTBEAT_MS);

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(tick);
    clearInterval(heartbeat);
  };
  req.on('close', close);
  res.on('close', close);
});
