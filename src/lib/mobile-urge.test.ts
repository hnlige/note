import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMobileUrgeRequests } from './mobile-urge.ts';

test('mobile urge expands selected receivers into singular API requests', () => {
  const requests = buildMobileUrgeRequests('item-1', ['owner-1', '', 'owner-1', 'owner-2'], '请尽快反馈', 123);

  assert.deepEqual(requests.map(({ itemId, receiverId, content, method }) => ({ itemId, receiverId, content, method })), [
    { itemId: 'item-1', receiverId: 'owner-1', content: '请尽快反馈', method: 'SYSTEM' },
    { itemId: 'item-1', receiverId: 'owner-2', content: '请尽快反馈', method: 'SYSTEM' },
  ]);
  assert.notEqual(requests[0].idempotencyKey, requests[1].idempotencyKey);
});

test('mobile urge returns no request when no valid receiver is selected', () => {
  assert.deepEqual(buildMobileUrgeRequests('item-1', ['', '  '], '请尽快反馈', 123), []);
});
