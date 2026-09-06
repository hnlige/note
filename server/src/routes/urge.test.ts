import test from 'node:test';
import assert from 'node:assert/strict';

import { asStringArray, buildBatchUrgeIdempotencyKey, describeUrgeMethod, getUrgeTargetIds, normalizeUrgeContent } from './urge';

test('normalizeUrgeContent falls back when content is missing', () => {
  assert.equal(normalizeUrgeContent(undefined), '请及时查看并反馈处理进展。');
  assert.equal(normalizeUrgeContent('   '), '请及时查看并反馈处理进展。');
});

test('normalizeUrgeContent trims provided content', () => {
  assert.equal(normalizeUrgeContent('  请今日反馈进度  '), '请今日反馈进度');
});

test('asStringArray parses comma-separated query ids', () => {
  assert.deepEqual(asStringArray('item-1,item-2, item-3'), ['item-1', 'item-2', 'item-3']);
});

test('getUrgeTargetIds only returns users associated with the item', () => {
  assert.deepEqual(getUrgeTargetIds({
    ownerId: 'o1', ownerIds: ['o1', 'o2'], followerId: 'f1', followerIds: ['f1', 'f2'],
    subTasks: [{ assigneeId: 'o3' }],
  }), ['o1', 'o2', 'f1', 'f2', 'o3']);
});

test('buildBatchUrgeIdempotencyKey fits the database column and isolates each item target', () => {
  const requestKey = 'a1111111-1111-4111-8111-111111111111';
  const itemOne = buildBatchUrgeIdempotencyKey(requestKey, 'b2222222-2222-4222-8222-222222222222', 'c3333333-3333-4333-8333-333333333333', 'd4444444-4444-4444-8444-444444444444');
  const itemTwo = buildBatchUrgeIdempotencyKey(requestKey, 'e5555555-5555-4555-8555-555555555555', 'c3333333-3333-4333-8333-333333333333', 'd4444444-4444-4444-8444-444444444444');

  assert.equal(itemOne.length, 64);
  assert.notEqual(itemOne, itemTwo);
  assert.equal(itemOne, buildBatchUrgeIdempotencyKey(requestKey, 'b2222222-2222-4222-8222-222222222222', 'c3333333-3333-4333-8333-333333333333', 'd4444444-4444-4444-8444-444444444444'));
});

test('describeUrgeMethod maps enums to Chinese labels', () => {
  assert.equal(describeUrgeMethod('SYSTEM'), '站内推送');
  assert.equal(describeUrgeMethod('MESSAGE'), '消息通知');
  assert.equal(describeUrgeMethod('PHONE'), '电话催办');
  assert.equal(describeUrgeMethod('UNKNOWN'), '消息通知');
});
