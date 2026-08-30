import type { NextFunction, Request, Response } from 'express';
import { getRedisClient } from './redis';

type RedisRateLimitClient = {
  eval: (script: string, options: { keys: string[]; arguments: string[] }) => Promise<number>;
};

type RateLimitOptions = {
  limit: number;
  windowMs: number;
  namespace?: string;
  skip?: (req: Request) => boolean;
  keyGenerator?: (req: Request) => string; // 自定义限流键生成器（支持用户级限流）
};

type LocalEntry = { count: number; resetAt: number };

const fixedWindowScript = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
  return count
`;

export function buildRateLimitKey(ip: string, now: number, windowMs: number, namespace = 'duban:rate-limit'): string {
  return `${namespace}:${Math.floor(now / windowMs)}:${ip}`;
}

export async function consumeRedisFixedWindow(
  redis: RedisRateLimitClient,
  key: string,
  windowMs: number,
): Promise<number> {
  return redis.eval(fixedWindowScript, { keys: [key], arguments: [String(windowMs)] });
}

/** Redis keeps rate limits consistent across PM2 instances; memory is an availability fallback. */
export function createRateLimitMiddleware(options: RateLimitOptions) {
  const localCounts = new Map<string, LocalEntry>();
  const namespace = options.namespace || 'duban:rate-limit';

  const consumeLocal = (ip: string, now: number): number => {
    const current = localCounts.get(ip);
    const entry = !current || now >= current.resetAt
      ? { count: 0, resetAt: now + options.windowMs }
      : current;
    entry.count += 1;
    localCounts.set(ip, entry);

    // Keep the fallback bounded if Redis is unavailable for an extended period.
    if (localCounts.size > 10_000) {
      for (const [key, candidate] of localCounts) {
        if (now >= candidate.resetAt) localCounts.delete(key);
      }
    }
    return entry.count;
  };

  return async (req: Request, res: Response, next: NextFunction) => {
    if (options.skip?.(req)) return next();

    // 优先使用自定义 keyGenerator（支持用户级限流），回退到 IP
    const key = options.keyGenerator?.(req) || req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let count: number | null = null;

    try {
      const redis = await getRedisClient();
      if (redis) {
        count = await consumeRedisFixedWindow(
          redis as unknown as RedisRateLimitClient,
          buildRateLimitKey(key, now, options.windowMs, namespace),
          options.windowMs,
        );
      }
    } catch (error) {
      console.error('[Redis] rate limit failed, falling back to local limiter:', error);
    }

    const effectiveCount = count ?? consumeLocal(key, now);
    if (effectiveCount > options.limit) {
      return res.status(429).json({ error: '请求过于频繁，请稍后重试' });
    }
    return next();
  };
}
