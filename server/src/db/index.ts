import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import * as schema from './schema';

dotenv.config();

let db: any;

export async function getDb() {
  if (db) return db as ReturnType<typeof drizzle<typeof schema>>;

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const pool = mysql.createPool({
    uri: DATABASE_URL,
    connectionLimit: Number(process.env.DB_POOL_SIZE) || 50,
    waitForConnections: true,
    queueLimit: Number(process.env.DB_QUEUE_LIMIT) || 100, // 限制队列深度，防止 OOM
    connectTimeout: 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    // 查询执行超时（毫秒）
    ...(process.env.DB_QUERY_TIMEOUT ? { queryTimeout: Number(process.env.DB_QUERY_TIMEOUT) } : {}),
  });

  // 启动时验证连接
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();

  console.log(`[DB] Connection pool created (limit: ${Number(process.env.DB_POOL_SIZE) || 50})`);

  db = drizzle(pool, { schema, mode: 'default' });
  return db as ReturnType<typeof drizzle<typeof schema>>;
}

/** 关闭连接池，用于优雅退出 */
export async function closeDb() {
  if (!db) return;
  // Drizzle 内部持有 pool，直接从 mysql2 层面关闭
  const pool = (db as any)?.session?.client;
  if (pool && typeof pool.end === 'function') {
    await pool.end();
  }
  db = undefined;
}

export { schema };
