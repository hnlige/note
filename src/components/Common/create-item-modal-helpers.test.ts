import test from 'node:test';
import assert from 'node:assert/strict';

import { getInitialFollowers, isFollowerCandidate } from './create-item-modal-helpers';

test('getInitialFollowers starts empty instead of defaulting to current user', () => {
  assert.deepEqual(getInitialFollowers(), []);
});

test('isFollowerCandidate only allows follower roles', () => {
  assert.equal(
    isFollowerCandidate({ id: 'f1', role: '督办专员' }),
    true,
  );
  assert.equal(
    isFollowerCandidate({ id: 'f2', role: 'FOLLOWER' }),
    true,
  );
  assert.equal(
    isFollowerCandidate({ id: 'f3', roleId: 'r2' }),
    true,
  );
  assert.equal(
    isFollowerCandidate({ id: 'o1', role: '责任人', roleId: 'r6' }),
    false,
  );
});
