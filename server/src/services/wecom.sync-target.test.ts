import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSyncTarget } from './wecom.sync-target.js';

test('resolveSyncTarget prefers exact wecom_user_id match over job_number', () => {
  const byWecomId = new Map([['zhangsan', { id: 'u1', username: '00010050', wecomUserId: 'zhangsan' }]]);
  const byUsername = new Map([['00020060', { id: 'u2', username: '00020060' }]]);

  const decision = resolveSyncTarget(
    { userid: 'zhangsan', job_number: '00020060' },
    byWecomId,
    byUsername,
  );
  assert.deepEqual(decision, { targetId: 'u1', via: 'wecom_id' });
});

test('resolveSyncTarget links when job_number uniquely hits an unlinked login account', () => {
  const byWecomId = new Map();
  const byUsername = new Map([['00010050', { id: 'u1', username: '00010050' }]]);

  const decision = resolveSyncTarget({ userid: 'huangzhihao', job_number: '00010050' }, byWecomId, byUsername);
  assert.deepEqual(decision, { targetId: 'u1', via: 'job_number' });
});

test('resolveSyncTarget trims whitespace around job_number and usernames', () => {
  const byWecomId = new Map();
  const byUsername = new Map([['00010050', { id: 'u1', username: '00010050' }]]);

  const decision = resolveSyncTarget({ userid: 'huangzhihao', job_number: ' 00010050 ' }, byWecomId, byUsername);
  assert.deepEqual(decision, { targetId: 'u1', via: 'job_number' });
});

test('resolveSyncTarget creates when job_number matches no login account', () => {
  const byUsername = new Map([['00010050', { id: 'u1', username: '00010050' }]]);
  const decision = resolveSyncTarget({ userid: 'newbie', job_number: '99999999' }, new Map(), byUsername);
  assert.deepEqual(decision, { targetId: null, via: 'create' });
});

test('resolveSyncTarget creates when member has no job_number at all', () => {
  const byUsername = new Map([['00010050', { id: 'u1', username: '00010050' }]]);
  const decision = resolveSyncTarget({ userid: 'newbie' }, new Map(), byUsername);
  assert.deepEqual(decision, { targetId: null, via: 'create' });
});

test('resolveSyncTarget treats empty-string job_number as absent', () => {
  const byUsername = new Map([['00010050', { id: 'u1', username: '00010050' }]]);
  const decision = resolveSyncTarget({ userid: 'newbie', job_number: '   ' }, new Map(), byUsername);
  assert.deepEqual(decision, { targetId: null, via: 'create' });
});

test('resolveSyncTarget creates for accounts that are already linked (absent from username index)', () => {
  // 已绑定账号不在 byUsername 索引中（调用方构建索引时排除），因此不会被其他成员再次绑定
  const byWecomId = new Map([['zhangsan', { id: 'u1', username: '00010050', wecomUserId: 'zhangsan' }]]);
  const byUsername = new Map();
  const decision = resolveSyncTarget({ userid: 'someone-else', job_number: '00010050' }, byWecomId, byUsername);
  assert.deepEqual(decision, { targetId: null, via: 'create' });
});
