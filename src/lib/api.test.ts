import test from 'node:test';
import assert from 'node:assert/strict';

import { api, compactItemUpdatePayload, hasAuthToken } from './api.ts';

test('hasAuthToken returns false when storage has no auth token', () => {
  const storage = {
    getItem: () => null,
  };

  assert.equal(hasAuthToken(storage as Pick<Storage, 'getItem'>), false);
});

test('hasAuthToken returns true when storage has auth token', () => {
  const storage = {
    getItem: (key: string) => key === 'duban-auth-token' ? 'token-value' : null,
  };

  assert.equal(hasAuthToken(storage as Pick<Storage, 'getItem'>), true);
});

test('item update payload sends only the latest timeline candidate', () => {
  const historical = { id: 'old', type: 'CREATE' };
  const latest = { id: 'new', type: 'FEEDBACK', user: '客户端显示名' };
  const payload = { progress: 50, timeline: [historical, latest] };

  assert.deepEqual(compactItemUpdatePayload(payload), { progress: 50, timeline: [latest] });
  assert.equal(payload.timeline.length, 2);
  assert.deepEqual(compactItemUpdatePayload({ timeline: [] }), { timeline: [] });
});

test('item writes send explicit page context in a dedicated header', async () => {
  const originalFetch = globalThis.fetch;
  const capturedInits: RequestInit[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedInits.push(init || {});
    return new Response(JSON.stringify({ id: 'item-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const createWithContext = api.items.create as unknown as (
      data: Record<string, unknown>,
      pageAuth: string,
    ) => Promise<{ id: string }>;
    await createWithContext({ title: '测试事项' }, 'MENU_ITEMS');
    await api.items.update('item-1', { title: '更新事项' }, 'MENU_MY_ITEMS');
    await api.items.updateStatus('item-1', 'EXECUTING', 'MENU_WORKBENCH');

    assert.deepEqual(
      capturedInits.map((init) => new Headers(init.headers).get('X-Page-Auth')),
      ['MENU_ITEMS', 'MENU_MY_ITEMS', 'MENU_WORKBENCH'],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('item writes keep Authorization alongside X-Page-Auth (regression: ...options must not overwrite auth headers)', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;

  globalThis.window = {} as Window & typeof globalThis;
  globalThis.localStorage = {
    getItem: (key: string) => key === 'duban-auth-token' ? 'my-token' : null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  };

  const capturedHeaders: Headers[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedHeaders.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ id: 'item-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const createWithContext = api.items.create as unknown as (
      data: Record<string, unknown>,
      pageAuth: string,
    ) => Promise<{ id: string }>;
    await createWithContext({ title: '测试事项' }, 'MENU_ITEMS');
    // 修复前：options.headers(X-Page-Auth)会整体覆盖掉含 Authorization 的 headers → Authorization 丢失 → 401。
    assert.equal(capturedHeaders[0]?.get('Authorization'), 'Bearer my-token');
    assert.equal(capturedHeaders[0]?.get('X-Page-Auth'), 'MENU_ITEMS');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('item list requests server-side pagination', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = (async (input: string | URL | Request) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({ data: [], pagination: { page: 2, pageSize: 25, total: 0, totalPages: 0 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await api.items.list(2, 25);
    assert.match(capturedUrl, /\/items\?page=2&pageSize=25$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('request stores a renewed auth token returned by the backend', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  let storedToken = '';

  globalThis.window = {} as Window & typeof globalThis;
  globalThis.localStorage = {
    getItem: (key: string) => key === 'duban-auth-token' ? 'old-token' : null,
    setItem: (key: string, value: string) => {
      if (key === 'duban-auth-token') storedToken = value;
    },
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  };
  globalThis.fetch = (async () => new Response(JSON.stringify([]), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Duban-Auth-Token': 'renewed-token',
    },
  })) as typeof fetch;

  try {
    await api.items.list();
    assert.equal(storedToken, 'renewed-token');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
});
