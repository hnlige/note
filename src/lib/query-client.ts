import { QueryClient } from '@tanstack/react-query';

/**
 * 全局 QueryClient 单例。
 *
 * 用途：MainLayout 的 bootstrap 数据（roles/items/urge/departments/...）经 react-query
 * 调度，路由切换重新挂载时命中同一缓存键即可免重放（此前每次切页重放 8-11 个请求）。
 * UI 数据源仍是 zustand store（useStore），queryFn 即各 sync 函数——react-query 只做
 * 请求去重与新鲜度控制，不改任何页面消费方式。
 *
 * staleTime 口径：业务数据 15s（与消息轮询周期一致，最坏陈旧度不超过旧轮询语义），
 * 配置类数据 60s（后端 cacheMiddleware 同为 60s）。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      gcTime: 5 * 60 * 1000,
    },
  },
});

/** 业务/配置数据的统一 staleTime 常量。 */
export const STALE_TIME = {
  business: 15 * 1000,
  config: 60 * 1000,
} as const;
