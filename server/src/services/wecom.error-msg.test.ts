import test from 'node:test';
import assert from 'node:assert/strict';

import { translateWecomError } from './wecom.error-msg';

test('translates 60011 with actionable hint for contact privilege', () => {
  const msg = translateWecomError('获取企业微信成员详情', 60011, 'no privilege to access/modify contact/party/agent');
  assert.ok(msg.includes('60011'));
  assert.ok(msg.includes('通讯录'));
  assert.ok(msg.includes('获取企业微信成员详情失败'));
});

test('translates 60020 with trusted IP hint', () => {
  const msg = translateWecomError('获取企业微信部门树', 60020, 'not allow to access from your ip');
  assert.ok(msg.includes('可信 IP'));
  assert.ok(msg.includes('获取企业微信部门树失败'));
});

test('keeps original errmsg for unmapped errcode', () => {
  const msg = translateWecomError('获取企业微信成员详情', 81013, 'userid not found');
  assert.ok(msg.includes('81013'));
  assert.ok(msg.includes('userid not found'));
  assert.ok(!msg.includes('。'));
});

test('falls back to 未知错误 when errmsg missing', () => {
  const msg = translateWecomError('获取企业微信部门树', 60011);
  assert.ok(msg.includes('未知错误'));
  assert.ok(msg.includes('通讯录'));
});
