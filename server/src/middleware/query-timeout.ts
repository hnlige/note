import type { NextFunction, Request, Response } from 'express';

/**
 * 慢查询超时中间件，用于隔离慢接口（如导出/统计），防止占满连接池拖垮其他请求。
 * 
 * @param maxMs 最大允许的查询时间（毫秒）
 * @returns Express 中间件
 * 
 * @example
 * // 导出接口最多 10 秒超时
 * app.use('/api/items/export', requireAuth, queryTimeoutMiddleware(10000), exportRouter);
 * 
 * // 统计接口最多 15 秒超时
 * app.use('/api/statistics', requireAuth, queryTimeoutMiddleware(15000), statisticsRouter);
 */
export function queryTimeoutMiddleware(maxMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeoutId = setTimeout(() => {
      if (!res.headersSent) {
        console.warn(`[Query Timeout] ${req.method} ${req.path} exceeded ${maxMs}ms`);
        res.status(504).json({ 
          error: '查询超时，请缩小数据范围后重试',
          code: 'QUERY_TIMEOUT'
        });
      }
    }, maxMs);
    
    res.on('finish', () => clearTimeout(timeoutId));
    res.on('close', () => clearTimeout(timeoutId));
    
    next();
  };
}
