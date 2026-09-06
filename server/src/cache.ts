import { getRedisClient, isRedisConfigured } from './redis';

/** L1 内存缓存 + 可选 Redis 共享缓存，用于低频变更数据。 */

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * 缓存中间件工厂函数
 *
 * 对 GET 请求缓存响应体；POST/PUT/DELETE 请求会自动清空对应命名空间的缓存
 *
 * @param namespace 缓存命名空间（如 'roles', 'departments'）
 * @param ttlMs     缓存有效期（毫秒），默认 60000
 */
export function cacheMiddleware(namespace: string, ttlMs = 60_000) {
  if (isRedisConfigured()) return distributedCacheMiddleware(namespace, ttlMs);

  return (req: any, res: any, next: any) => {
    // 写操作自动失效缓存
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      invalidate(namespace);
      return next();
    }

    const userScopedSuffix = req.authUser?.id ? `:user:${req.authUser.id}` : '';
    const key = `${namespace}${userScopedSuffix}:${req.originalUrl || req.url}`;
    const entry = store.get(key);
    if (entry && Date.now() < entry.expiry) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(entry.data);
    }

    // 拦截 res.json 以缓存响应
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        store.set(key, { data: body, expiry: Date.now() + ttlMs });
      }
      res.setHeader('X-Cache', 'MISS');
      return originalJson(body);
    };

    next();
  };
}

function distributedCacheMiddleware(namespace: string, ttlMs: number) {
  return async (req: any, res: any, next: any) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      invalidate(namespace);
      return next();
    }

    const userScopedSuffix = req.authUser?.id ? `:user:${req.authUser.id}` : '';
    const key = `${namespace}${userScopedSuffix}:${req.originalUrl || req.url}`;
    const entry = store.get(key);
    if (entry && Date.now() < entry.expiry) {
      res.setHeader('X-Cache', 'HIT-L1');
      return res.json(entry.data);
    }

    try {
      const redis = await getRedisClient();
      const cached = redis ? await redis.get(`duban:cache:${key}`) : null;
      if (cached) {
        const data = JSON.parse(cached);
        store.set(key, { data, expiry: Date.now() + ttlMs });
        res.setHeader('X-Cache', 'HIT-L2');
        return res.json(data);
      }
    } catch (error) {
      console.error('[Redis] cache read failed:', error);
    }

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        store.set(key, { data: body, expiry: Date.now() + ttlMs });
        void getRedisClient()
          .then((redis) => redis?.set(`duban:cache:${key}`, JSON.stringify(body), { PX: ttlMs }))
          .catch((error) => console.error('[Redis] cache write failed:', error));
      }
      res.setHeader('X-Cache', 'MISS');
      return originalJson(body);
    };
    next();
  };
}

/**
 * 使指定命名空间的所有缓存失效
 */
export function invalidate(namespace: string) {
  for (const key of store.keys()) {
    if (key.startsWith(`${namespace}:`)) {
      store.delete(key);
    }
  }
  if (isRedisConfigured()) {
    void getRedisClient()
      .then(async (redis) => {
        if (!redis) return;
        for await (const key of redis.scanIterator({ MATCH: `duban:cache:${namespace}:*`, COUNT: 100 })) {
          await redis.del(key);
        }
      })
      .catch((error) => console.error('[Redis] cache invalidation failed:', error));
  }
}

/**
 * 清空所有缓存（用于测试或部署后重置）
 */
export function invalidateAll() {
  store.clear();
}

/**
 * 获取缓存统计
 */
export function getCacheStats() {
  return {
    size: store.size,
    namespaces: [...new Set([...store.keys()].map((k) => k.split(':')[0]))],
  };
}

// 定期清理过期条目（每 5 分钟）。unref 避免常驻定时器阻止进程退出（如测试运行结束后）。
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now >= entry.expiry) store.delete(key);
  }
}, 5 * 60 * 1000).unref();
