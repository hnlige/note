import { createClient } from 'redis';

type RedisConnection = ReturnType<typeof createClient>;

let client: RedisConnection | null = null;
let connectPromise: Promise<RedisConnection | null> | null = null;
let retryAfter = 0;

export function isRedisConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.REDIS_URL?.trim());
}

export function getRedisStatus(): 'disabled' | 'ready' | 'unavailable' {
  if (!isRedisConfigured()) return 'disabled';
  return client?.isReady ? 'ready' : 'unavailable';
}

export async function initializeRedis(): Promise<RedisConnection | null> {
  if (!isRedisConfigured()) return null;
  if (client?.isReady) return client;
  if (connectPromise) return connectPromise;
  if (Date.now() < retryAfter) return null;

  const url = process.env.REDIS_URL!.trim();
  const nextClient = createClient({
    url,
    socket: {
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 3000,
      reconnectStrategy: false,
    },
  });
  nextClient.on('error', (error) => console.error('[Redis] client error:', error.message));

  connectPromise = nextClient.connect()
    .then(() => {
      client = nextClient;
      console.log('[Redis] connected');
      return client;
    })
    .catch((error) => {
      console.error('[Redis] connection unavailable:', error.message);
      retryAfter = Date.now() + (Number(process.env.REDIS_RETRY_DELAY_MS) || 10_000);
      void nextClient.disconnect().catch(() => undefined);
      return null;
    })
    .finally(() => {
      connectPromise = null;
    });

  return connectPromise;
}

export async function getRedisClient(): Promise<RedisConnection | null> {
  return client?.isReady ? client : initializeRedis();
}

export async function closeRedis(): Promise<void> {
  const current = client;
  client = null;
  retryAfter = 0;
  if (current?.isOpen) await current.quit();
}
