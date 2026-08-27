import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isExtensionDateAllowed,
  formatWheelDate,
  getDaysInMonth,
  getTomorrowDate,
  getWheelDays,
  isExtensionReasonValid,
  toDateInputValue,
  toManualDateValue,
} from './extension-modal-helpers.ts';

test('延期日期转换为 date input 所需的本地日期格式', () => {
  assert.equal(toDateInputValue('2026/09/03'), '2026-09-03');
  assert.equal(toDateInputValue('2026-09-03 12:30:00'), '2026-09-03');
  assert.equal(toDateInputValue('2026-09-03T00:00:00.000Z'), '2026-09-03');
  assert.equal(toDateInputValue('2026/02/30'), '');
  assert.equal(toManualDateValue('2026-09-03'), '2026/09/03');
});

test('延期后的新完成计划日期必须严格晚于今天', () => {
  assert.equal(isExtensionDateAllowed('2026-08-26', '2026/08/26'), false);
  assert.equal(isExtensionDateAllowed('2026-08-25', '2026/08/26'), false);
  assert.equal(isExtensionDateAllowed('2026-08-27', '2026/08/26'), true);
  assert.equal(isExtensionDateAllowed('2026/09/01', '2026/08/26'), true);
  assert.equal(isExtensionDateAllowed('invalid', '2026/08/26'), false);
});

test('滚轮日期按真实日历生成月份天数并裁剪日期', () => {
  assert.equal(getDaysInMonth(2028, 2), 29);
  assert.equal(getDaysInMonth(2027, 2), 28);
  assert.equal(getDaysInMonth(2026, 4), 30);
  assert.equal(getDaysInMonth(2026, 5), 31);
  assert.deepEqual(getWheelDays(2028, 2), Array.from({ length: 29 }, (_, index) => index + 1));
  assert.equal(formatWheelDate(2026, 8, 3), '2026-08-03');
});

test('滚轮日期默认可从今天选择到明天', () => {
  assert.equal(getTomorrowDate(new Date(2026, 11, 31)), '2027-01-01');
  assert.equal(getTomorrowDate(new Date(2028, 1, 28)), '2028-02-29');
});

test('延期原因遵守 5 至 500 字限制', () => {
  assert.equal(isExtensionReasonValid('1234'), false);
  assert.equal(isExtensionReasonValid(' 12345 '), true);
  assert.equal(isExtensionReasonValid('a'.repeat(500)), true);
  assert.equal(isExtensionReasonValid('a'.repeat(501)), false);
});
