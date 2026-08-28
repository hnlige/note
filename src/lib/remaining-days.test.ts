import test from 'node:test';
import assert from 'node:assert/strict';

import { computeRemainingDays } from './remaining-days';

const NOW = new Date(2026, 7, 28, 15, 30, 0); // 2026-08-28 15:30 本地时间

test('要求完成日期为当天时按「剩 1 天」展示（含当天）', () => {
  const result = computeRemainingDays({ requiredCompletionDate: '2026-08-28', now: NOW });
  assert.deepEqual(result, { kind: 'left', days: 1 });
});

test('日期基准优先取要求完成日期，忽略签收后回填的计划 deadline', () => {
  const result = computeRemainingDays({
    deadline: '2028-08-28',
    requiredCompletionDate: '2026-08-28',
    now: NOW,
  });
  assert.deepEqual(result, { kind: 'left', days: 1 });
});

test('无要求完成日期时回退 deadline，未来日期含当天倒计时', () => {
  const result = computeRemainingDays({ deadline: '2026-09-10', now: NOW });
  assert.deepEqual(result, { kind: 'left', days: 14 });
});

test('日期已过按「超期 N 天」展示', () => {
  const result = computeRemainingDays({ requiredCompletionDate: '2026-08-26', now: NOW });
  assert.deepEqual(result, { kind: 'overdue', days: 2 });
});

test('OVERDUE 状态即使要求日期未过也至少展示超期 1 天', () => {
  const result = computeRemainingDays({
    requiredCompletionDate: '2026-09-01',
    status: 'OVERDUE',
    now: NOW,
  });
  assert.deepEqual(result, { kind: 'overdue', days: 1 });
});

test('DELAYED（已批准延期）按新日期正常倒计时，不再强制显示超期', () => {
  const result = computeRemainingDays({
    deadline: '2026-09-15',
    requiredCompletionDate: '2026-08-20',
    status: 'DELAYED',
    now: NOW,
  });
  assert.deepEqual(result, { kind: 'left', days: 19 });
});

test('兼容斜杠日期与带时间的写法', () => {
  const slash = computeRemainingDays({ deadline: '2026/08/28', now: NOW });
  const withTime = computeRemainingDays({ requiredCompletionDate: '2026-08-28 00:00:00', now: NOW });
  assert.deepEqual(slash, { kind: 'left', days: 1 });
  assert.deepEqual(withTime, { kind: 'left', days: 1 });
});

test('未设日期或非法日期返回 none', () => {
  assert.deepEqual(computeRemainingDays({ now: NOW }), { kind: 'none', days: 0 });
  assert.deepEqual(computeRemainingDays({ deadline: 'not-a-date', now: NOW }), { kind: 'none', days: 0 });
});
