import test from 'node:test';
import assert from 'node:assert/strict';

import { useStore } from './useStore';

test('addLog sends only event content and stores the server-authoritative log', async () => {
  const previousState = useStore.getState();
  const originalFetch = globalThis.fetch;
  const serverLog = {
    id: 'server-log-id',
    userId: 'auth-user',
    userName: '真实用户',
    action: '事项删除',
    module: '督办事项',
    timestamp: '2026-08-08T10:00:00.000Z',
    ip: '10.0.0.8',
  };
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
    return new Response(JSON.stringify({ success: true, log: serverLog }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  useStore.setState({ logs: [] });

  try {
    await useStore.getState().addLog({
      userId: 'forged-user',
      userName: '伪造用户',
      action: '事项删除',
      module: '督办事项',
    });

    assert.deepEqual(requestBody, { action: '事项删除', module: '督办事项' });
    assert.deepEqual(useStore.getState().logs, [serverLog]);
  } finally {
    globalThis.fetch = originalFetch;
    useStore.setState(previousState, true);
  }
});

test('addLog does not store an untrusted local log when the server rejects it', async () => {
  const previousState = useStore.getState();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: '拒绝写入' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;
  useStore.setState({ logs: [] });

  try {
    await useStore.getState().addLog({
      userId: 'forged-user',
      userName: '伪造用户',
      action: '事项删除',
      module: '督办事项',
    });
    assert.deepEqual(useStore.getState().logs, []);
  } finally {
    globalThis.fetch = originalFetch;
    useStore.setState(previousState, true);
  }
});
