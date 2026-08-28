import test from 'node:test';
import assert from 'node:assert/strict';

import { migratePersistedState, partializePersistedState, writePersistedIdentity } from './useStore.ts';

test('persisted browser state excludes passwords and business data', () => {
  const persisted = partializePersistedState({
    currentUser: { id: 'user-1', name: '测试用户', role: 'OWNER' },
    searchTerm: '关键字',
  } as Parameters<typeof partializePersistedState>[0]) as Record<string, unknown>;

  assert.deepEqual(Object.keys(persisted).sort(), ['currentUser', 'searchTerm']);
  for (const forbiddenKey of ['passwords', 'items', 'messages', 'orgUsers', 'activities', 'logs']) {
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, forbiddenKey), false, `${forbiddenKey} must not be persisted`);
  }
});

test('storage migration discards all pre-v6 persisted state', () => {
  assert.equal(migratePersistedState({ passwords: { user1: 'plaintext' }, items: [{ id: 'item1' }] }, 5), undefined);
});

test('writePersistedIdentity 覆写 currentUser 并保留其余持久化字段', () => {
  const store: Record<string, string> = {
    'duban-storage': JSON.stringify({ state: { currentUser: { id: 'old-user', name: '上一位', role: 'OWNER' }, searchTerm: '遗留关键字' }, version: 6 }),
  };
  const localStorageMock = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
  };
  (globalThis as Record<string, unknown>).localStorage = localStorageMock;

  try {
    writePersistedIdentity({ id: 'new-user', name: '申林', role: 'OWNER' });

    const parsed = JSON.parse(store['duban-storage']);
    assert.equal(parsed.version, 6);
    assert.equal(parsed.state.currentUser.id, 'new-user');
    assert.equal(parsed.state.currentUser.name, '申林');
    // 其余已持久化字段（如 searchTerm）不被清除
    assert.equal(parsed.state.searchTerm, '遗留关键字');
  } finally {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
});

test('writePersistedIdentity 在存储为空时初始化结构，存储异常时不抛出', () => {
  const store: Record<string, string> = {};
  const localStorageMock = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
  };
  (globalThis as Record<string, unknown>).localStorage = localStorageMock;

  try {
    writePersistedIdentity({ id: 'u1', name: '吴丽珠', role: 'FOLLOWER' });
    const parsed = JSON.parse(store['duban-storage']);
    assert.equal(parsed.state.currentUser.name, '吴丽珠');

    // setItem 抛异常时静默跳过，不阻断登录流程
    localStorageMock.setItem = () => { throw new Error('QuotaExceededError'); };
    assert.doesNotThrow(() => writePersistedIdentity({ id: 'u2', name: '申林', role: 'OWNER' }));
  } finally {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
});
