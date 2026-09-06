import test from 'node:test';
import assert from 'node:assert/strict';

import { formatTaskTime, mapServerAsyncTask, sortTasksNewestFirst } from './task-sync';

test('mapServerAsyncTask maps server record to UI AsyncTask', () => {
  const task = mapServerAsyncTask({
    id: 't1',
    name: '企业微信通讯录同步',
    module: '组织架构',
    status: 'FAILED',
    progress: 100,
    result: '同步失败：获取企业微信成员详情失败: [60011] no privilege',
    startTime: '2026-09-05T04:34:32.000Z',
    endTime: '2026-09-05T04:34:33.000Z',
  });

  assert.equal(task.id, 't1');
  assert.equal(task.name, '企业微信通讯录同步');
  assert.equal(task.module, '组织架构');
  assert.equal(task.status, 'FAILED');
  assert.equal(task.progress, 100);
  assert.ok(task.result?.includes('60011'));
  assert.equal(task.type, 'EXPORT');
  assert.match(task.startTime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.match(task.endTime!, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('mapServerAsyncTask falls back for missing or unknown fields', () => {
  const task = mapServerAsyncTask({
    id: 't2',
    name: '任务B',
    status: 'SOME_NEW_STATUS',
    startTime: 'not-a-date',
  });

  assert.equal(task.status, 'PENDING');
  assert.equal(task.progress, 0);
  assert.equal(task.module, undefined);
  assert.equal(task.result, undefined);
  assert.equal(task.endTime, undefined);
  // 非法时间原样返回，页面不至于显示空
  assert.equal(task.startTime, 'not-a-date');
});

test('sortTasksNewestFirst puts latest startTime first and does not mutate input', () => {
  const tasks = [
    { id: 'a', startTime: '2026-09-05 08:00' },
    { id: 'b', startTime: '2026-09-05 12:34' },
    { id: 'c', startTime: '2026-09-04 09:00' },
  ] as any;

  const sorted = sortTasksNewestFirst(tasks);
  assert.deepEqual(sorted.map((t: { id: string }) => t.id), ['b', 'a', 'c']);
  assert.deepEqual(tasks.map((t: { id: string }) => t.id), ['a', 'b', 'c']);
});

test('formatTaskTime handles null and empty', () => {
  assert.equal(formatTaskTime(null), '');
  assert.equal(formatTaskTime(''), '');
});
