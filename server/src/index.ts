import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { itemsRouter } from './routes/items';
import { messagesRouter } from './routes/messages';
import { urgeRouter } from './routes/urge';
import { authRouter } from './routes/auth';
import { departmentsRouter } from './routes/departments';
import { usersRouter } from './routes/users';
import { activitiesRouter } from './routes/activities';
import { lightRouter } from './routes/lights';
import { rolesRouter } from './routes/roles';
import { templatesRouter } from './routes/templates';
import { dictionariesRouter } from './routes/dictionaries';
import { auditRouter } from './routes/audit';
import { asyncTasksRouter } from './routes/asyncTasks';
import { globalRulesRouter } from './routes/globalRules';
import { logsRouter } from './routes/logs';
import { wecomRouter } from './routes/wecom';
import { messagesStreamRouter } from './routes/messages.stream';
import { reassignRouter } from './routes/reassign';
import { attachmentsRouter } from './routes/attachments';
import { requireAuth } from './routes/auth.middleware';
import { getDb, closeDb } from './db';
import { closeRedis, initializeRedis } from './redis';
import { ensureDatabaseSchema } from './db/schema.ensure';
import { ensureItemAccessBackfillAtStartup } from './routes/item-access';
import { getHealthPayload } from './health';
import { cacheMiddleware } from './cache';
import { configureTrustedProxy } from './trust-proxy';
import { startItemAutoEngine } from './jobs/item-auto-engine';
import { createRateLimitMiddleware } from './rate-limit';
import { queryTimeoutMiddleware } from './middleware/query-timeout';

dotenv.config();

const app = express();
configureTrustedProxy(app);
const PORT = process.env.PORT || 3001;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

// ── 安全与请求控制 ──
// 限制请求体大小，防止大 payload 攻击
app.use(express.json({ limit: '1mb' }));

// CORS
app.use(cors({
  origin: [frontendUrl, 'http://localhost:5173', 'http://localhost:4173'],
  credentials: true,
  exposedHeaders: ['X-Duban-Auth-Token'],
}));

// 全局请求超时（30秒，防止慢请求耗尽资源）；SSE 流式响应不适用（headers 立即发送、连接长驻）
app.use((req: import('express').Request, res, next) => {
  if (req.path === '/api/messages/stream') return next();
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(503).json({ error: '请求超时，请稍后重试' });
    }
  }, 30000);
  res.on('finish', () => clearTimeout(timeout));
  next();
});

// ── 速率限制 ──
// 全局限制：优先按用户限流，回退到 IP 限流
const M = 60 * 1000;
const GLOBAL_RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE) || 600;

// 本地回环地址白名单（开发环境 HMR 会产生大量请求）
const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);
const isDev = process.env.NODE_ENV !== 'production';

app.use(createRateLimitMiddleware({
  limit: GLOBAL_RATE_LIMIT,
  windowMs: M,
  skip: (req) => isDev && LOCALHOST_IPS.has(req.ip || req.socket.remoteAddress || ''),
  // 优先使用用户 ID 限流（避免同一公司 IP 下多用户误伤），无认证时回退到 IP
  keyGenerator: (req) => {
    const authUser = (req as any).authUser;
    return authUser?.id || req.ip || req.socket.remoteAddress || 'unknown';
  },
}));

// ── 健康检查（不受限流影响） ──
app.get('/health', (_req, res) => res.json(getHealthPayload()));
app.get('/api/health', (_req, res) => res.json(getHealthPayload()));

// 企业微信回调（无需认证）
app.use('/api/wecom', wecomRouter);

// 消息 SSE 推送（token 经 query 鉴权，路由内部自校验；需挂在全局超时中间件豁免之后）
app.use('/api/messages/stream', messagesStreamRouter);

// ── 业务路由 ──
app.use('/api/auth', authRouter);

// 低频变更数据路由使用缓存中间件
// 开发模式 TTL 2 秒（快速反馈），生产模式 60 秒
const cacheTtl = process.env.NODE_ENV === 'production' ? 60000 : 2000;
app.use('/api/roles', requireAuth, cacheMiddleware('roles', cacheTtl), rolesRouter);
app.use('/api/departments', requireAuth, cacheMiddleware('departments', cacheTtl), departmentsRouter);
app.use('/api/dictionaries', requireAuth, cacheMiddleware('dictionaries', cacheTtl), dictionariesRouter);

// 高频数据路由
// items 路由包含批量导入等慢操作，添加 15s 超时保护
app.use('/api/items', requireAuth, queryTimeoutMiddleware(15000), itemsRouter);
app.use('/api/attachments', requireAuth, attachmentsRouter);
app.use('/api/messages', requireAuth, messagesRouter);
app.use('/api/urge', requireAuth, urgeRouter);
app.use('/api/users', requireAuth, usersRouter);
app.use('/api/activities', requireAuth, activitiesRouter);
app.use('/api/light-records', requireAuth, lightRouter);
app.use('/api/templates', requireAuth, templatesRouter);
app.use('/api/audit', requireAuth, auditRouter);
app.use('/api/async-tasks', requireAuth, asyncTasksRouter);
app.use('/api/global-rules', requireAuth, globalRulesRouter);
app.use('/api/logs', requireAuth, logsRouter);
app.use('/api/admin/reassign-supervision', requireAuth, reassignRouter);

// ── 全局错误处理中间件 ──
// 捕获所有未处理异常，统一返回 JSON 格式错误，避免 Express 默认返回 HTML 500 页面
// 必须放在所有路由之后、startServer 之前注册
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: '服务器内部错误', code: 'INTERNAL_ERROR' });
});

// ── 启动服务 ──
async function startServer() {
  const db = await getDb();
  const redis = await initializeRedis();
  if (process.env.REDIS_REQUIRED === 'true' && !redis) {
    throw new Error('REDIS_REQUIRED=true but Redis is unavailable');
  }
  await ensureDatabaseSchema(db);
  // 部署后一次性回填 item_access（表空且 items 有数据时执行，GET_LOCK 防多实例并发）
  const mysqlPool = (db as any)?.session?.client;
  if (mysqlPool?.getConnection) {
    await ensureItemAccessBackfillAtStartup(db, mysqlPool);
  }
  const stopAutoEngine = startItemAutoEngine(db);

  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT} [pid: ${process.pid}]`);
  });

  // 优雅退出
  const shutdown = async (signal: string) => {
    console.log(`\n[${signal}] Shutting down gracefully...`);
    server.close(() => {
      console.log('HTTP server closed');
    });
    stopAutoEngine();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
