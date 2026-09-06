import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRateLimitKey, consumeRedisFixedWindow } from './rate-limit';

test('rate limit key is shared by all instances in the same fixed window', () => {
  assert.equal(
    buildRateLimitKey('203.0.113.10', 125_000, 60_000),
    'duban:rate-limit:2:203.0.113.10',
  );
});

test('Redis fixed-window increment sets TTL atomically with the first increment', async () => {
  let script = '';
  let options: { keys: string[]; arguments: string[] } | undefined;
  const result = await consumeRedisFixedWindow({
    eval: async (inputScript, inputOptions) => {
      script = inputScript;
      options = inputOptions;
      return 3;
    },
  }, 'duban:rate-limit:2:203.0.113.10', 60_000);

  assert.equal(result, 3);
  assert.match(script, /INCR/);
  assert.match(script, /PEXPIRE/);
  assert.deepEqual(options, { keys: ['duban:rate-limit:2:203.0.113.10'], arguments: ['60000'] });
});
