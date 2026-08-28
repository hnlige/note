import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { normalizeUrgeIdempotencyKey } from './urge';

test('64 字符以内的幂等键原样保留', () => {
  const key = 'a'.repeat(64);
  assert.equal(normalizeUrgeIdempotencyKey(key), key);
  assert.equal(normalizeUrgeIdempotencyKey('short-key'), 'short-key');
});

test('移动端 94 字符幂等键折叠为 64 位 sha256，且映射稳定可去重', () => {
  const mobileKey = `urge_4d188314-e1cc-4ed6-b82b-5f12ed11aaa1_edead11b-4ee5-49fd-b33d-f72694823995_1777600000000_0`;
  assert.equal(mobileKey.length, 94);
  assert.ok(mobileKey.length > 64);

  const normalized = normalizeUrgeIdempotencyKey(mobileKey);
  assert.equal(normalized.length, 64);
  assert.match(normalized, /^[0-9a-f]{64}$/);
  assert.equal(normalized, createHash('sha256').update(mobileKey).digest('hex'));
  // 同键重试必须映射到同一个值，保证幂等去重语义不变
  assert.equal(normalized, normalizeUrgeIdempotencyKey(mobileKey));
  // 不同键不得碰撞成同一值
  assert.notEqual(
    normalized,
    normalizeUrgeIdempotencyKey(`${mobileKey}_1`),
  );
});
