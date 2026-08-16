import test from 'node:test';
import assert from 'node:assert/strict';

import { migratePersistedState, partializePersistedState } from './useStore.ts';

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
