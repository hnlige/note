import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePhone, resolveSyncTarget } from './wecom.sync-target.js';

test('normalizePhone strips non-digits and mainland country code 86', () => {
  assert.equal(normalizePhone('13800138000'), '13800138000');
  assert.equal(normalizePhone('+86 138-0013-8000'), '13800138000');
  assert.equal(normalizePhone('8613800138000'), '13800138000');
  assert.equal(normalizePhone(' 13800138000 '), '13800138000');
  assert.equal(normalizePhone(13800138000), '13800138000');
  assert.equal(normalizePhone(null), '');
  assert.equal(normalizePhone(undefined), '');
  assert.equal(normalizePhone(''), '');
  // 非手机号格式（如带 86 的短号/座机）不做 86 裁剪，仅去非数字
  assert.equal(normalizePhone('0571-88888888'), '057188888888');
});

test('resolveSyncTarget prefers exact wecom_user_id match over phone', () => {
  const byWecomId = new Map([['zhangsan', { id: 'u1', wecomUserId: 'zhangsan', phone: '13800138000' }]]);
  const byPhone = new Map([['13900139000', [{ id: 'u2', phone: '13900139000' }]]]);

  const decision = resolveSyncTarget({ userid: 'zhangsan', mobile: '13900139000' }, byWecomId, byPhone);
  assert.deepEqual(decision, { targetId: 'u1', via: 'wecom_id' });
});

test('resolveSyncTarget links by unique phone hit', () => {
  const byWecomId = new Map();
  const byPhone = new Map([['13800138000', [{ id: 'u1', phone: '13800138000' }]]]);

  const decision = resolveSyncTarget({ userid: 'newbie', mobile: '13800138000' }, byWecomId, byPhone);
  assert.deepEqual(decision, { targetId: 'u1', via: 'phone' });
});

test('resolveSyncTarget normalizes +86 mobile from wecom before matching', () => {
  const byWecomId = new Map();
  const byPhone = new Map([['13800138000', [{ id: 'u1', phone: '13800138000' }]]]);

  const decision = resolveSyncTarget({ userid: 'newbie', mobile: '+8613800138000' }, byWecomId, byPhone);
  assert.deepEqual(decision, { targetId: 'u1', via: 'phone' });
});

test('resolveSyncTarget skips when phone hits multiple local accounts', () => {
  const byWecomId = new Map();
  const byPhone = new Map([['13800138000', [
    { id: 'u1', phone: '13800138000' },
    { id: 'u2', phone: '138-0013-8000' },
  ]]]);

  const decision = resolveSyncTarget({ userid: 'newbie', mobile: '13800138000' }, byWecomId, byPhone);
  assert.deepEqual(decision, { targetId: null, via: 'phone_conflict' });
});

test('resolveSyncTarget falls back to create when nothing matches', () => {
  const decision = resolveSyncTarget({ userid: 'newbie', mobile: '13700137000' }, new Map(), new Map());
  assert.deepEqual(decision, { targetId: null, via: 'create' });
});

test('resolveSyncTarget creates when member has no mobile at all', () => {
  const byPhone = new Map([['13800138000', [{ id: 'u1', phone: '13800138000' }]]]);
  const decision = resolveSyncTarget({ userid: 'newbie' }, new Map(), byPhone);
  assert.deepEqual(decision, { targetId: null, via: 'create' });
});
