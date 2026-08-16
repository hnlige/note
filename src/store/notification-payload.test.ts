import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeMessagePayload, normalizeUrgePayload } from './notification-payload.ts';

test('normalizeMessagePayload keeps explicit ids and removes empty legacy strings', () => {
  assert.deepEqual(
    normalizeMessagePayload({
      title: '催办通知',
      content: 'test',
      type: 'URGE',
      receiverId: '2',
      receiverName: '',
      senderId: '1',
      senderName: '',
    }),
    {
      title: '催办通知',
      content: 'test',
      type: 'URGE',
      receiverId: '2',
      senderId: '1',
    },
  );
});

test('normalizeUrgePayload keeps explicit ids and preserves display names', () => {
  assert.deepEqual(
    normalizeUrgePayload({
      itemId: 'i1',
      itemTitle: '事项 A',
      receiverId: '2',
      receiver: '李承办',
      senderId: '1',
      sender: '张管理',
      status: 'UNREAD',
      method: 'MESSAGE',
      content: '请今天反馈进度',
    }),
    {
      itemId: 'i1',
      itemTitle: '事项 A',
      receiverId: '2',
      receiver: '李承办',
      senderId: '1',
      sender: '张管理',
      status: 'UNREAD',
      method: 'MESSAGE',
      content: '请今天反馈进度',
    },
  );
});
