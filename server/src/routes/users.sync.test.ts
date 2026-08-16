import test from 'node:test';
import assert from 'node:assert/strict';

import { getUsersToCreate, isDuplicateUserError } from './users.sync.js';

test('getUsersToCreate filters users that already exist by id or username', () => {
  const existingUsers = [
    { id: '6', username: 'dingmin' },
    { id: '7', username: 'weihongyi' },
  ];

  const incomingUsers = [
    { id: '6', username: 'dingmin', name: '丁敏' },
    { id: '8', username: 'weihongyi', name: '魏红义重复账号' },
    { id: '9', username: 'lichengban', name: '李承办处室' },
  ];

  assert.deepEqual(getUsersToCreate(existingUsers, incomingUsers), [
    { id: '9', username: 'lichengban', name: '李承办处室' },
  ]);
});

test('isDuplicateUserError returns true for mysql duplicate key errors', () => {
  assert.equal(isDuplicateUserError({ errno: 1062 }), true);
  assert.equal(isDuplicateUserError({ code: 'ER_DUP_ENTRY' }), true);
  assert.equal(isDuplicateUserError(new Error('other error')), false);
});
