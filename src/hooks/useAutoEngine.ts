/**
 * 已停用的浏览器自动引擎。
 *
 * 自动超期、亮灯、催办和提醒只能由服务端 `item-auto-engine` 执行：浏览器会话既
 * 不是单例，也无法提供跨用户的幂等与事务保证。保留此空 hook 仅用于兼容历史
 * `AutoEngine` 组件；它不读取 store、不启动定时器、更不会发起 API 写请求。
 */
export function useAutoEngine(): void {
  // Intentionally empty. See server/src/jobs/item-auto-engine.ts.
}
