import test from 'node:test';
import assert from 'node:assert/strict';

import { getTodayUrgeRecords } from './monitoring-metrics.ts';
import { UrgeRecord } from '../../types';

function urge(id: string, timestamp: string): UrgeRecord {
  return {
    id,
    itemId: `item-${id}`,
    itemTitle: `事项-${id}`,
    sender: '发起人',
    receiver: '责任人',
    timestamp,
    status: 'UNREAD',
    method: 'MESSAGE',
  };
}

test('getTodayUrgeRecords returns only records created on the current local date', () => {
  const today = new Date('2026-07-30T12:00:00+08:00');

  const result = getTodayUrgeRecords([
    urge('date-time', '2026-07-30 08:30'),
    urge('slash-date', '2026/07/30 10:15'),
    urge('iso', '2026-07-30T01:00:00.000Z'),
    urge('yesterday', '2026-07-29 23:59'),
    urge('tomorrow', '2026-07-31 00:01'),
    urge('invalid', '不是日期'),
  ], today);

  assert.deepEqual(result.map(record => record.id), ['date-time', 'slash-date', 'iso']);
});
