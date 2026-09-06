import { test } from 'node:test';
import assert from 'node:assert';
import { queryTimeoutMiddleware } from '../middleware/query-timeout';

test('queryTimeoutMiddleware 应该在超时后返回 504', async () => {
  const middleware = queryTimeoutMiddleware(100); // 100ms 超时
  
  let responseStatus: number | undefined;
  let responseBody: any;
  let headersSent = false;

  const mockReq = {
    method: 'GET',
    path: '/api/test',
  } as any;

  const mockRes = {
    headersSent: false,
    status(code: number) {
      responseStatus = code;
      return this;
    },
    json(body: any) {
      responseBody = body;
      headersSent = true;
      this.headersSent = true;
    },
    on(event: string, callback: Function) {
      if (event === 'finish' && headersSent) {
        callback();
      }
      if (event === 'close' && headersSent) {
        callback();
      }
    },
  } as any;

  const mockNext = () => {
    // 模拟慢操作，不立即响应
  };

  middleware(mockReq, mockRes, mockNext);

  // 等待超时触发
  await new Promise(resolve => setTimeout(resolve, 150));

  assert.strictEqual(responseStatus, 504, '应该返回 504 状态码');
  assert.strictEqual(responseBody.code, 'QUERY_TIMEOUT', '应该返回 QUERY_TIMEOUT 错误码');
  assert.ok(responseBody.error.includes('查询超时'), '应该包含超时错误信息');
});

test('queryTimeoutMiddleware 应该在正常响应时清除定时器', async () => {
  const middleware = queryTimeoutMiddleware(1000); // 1秒超时
  
  let responseStatus: number | undefined;
  let nextCalled = false;
  const finishCallbacks: Function[] = [];

  const mockReq = {
    method: 'GET',
    path: '/api/test',
  } as any;

  const mockRes = {
    headersSent: false,
    status(code: number) {
      responseStatus = code;
      return this;
    },
    json() {
      this.headersSent = true;
      // 触发 finish 回调
      finishCallbacks.forEach(cb => cb());
    },
    on(event: string, callback: Function) {
      if (event === 'finish') {
        finishCallbacks.push(callback);
      }
    },
  } as any;

  const mockNext = () => {
    nextCalled = true;
  };

  middleware(mockReq, mockRes, mockNext);

  assert.strictEqual(nextCalled, true, 'next 应该被调用');
  
  // 模拟正常响应
  mockRes.json({ success: true });

  // 等待一段时间，确认超时没有触发
  await new Promise(resolve => setTimeout(resolve, 100));

  assert.strictEqual(responseStatus, undefined, '正常响应不应该被超时覆盖');
});
