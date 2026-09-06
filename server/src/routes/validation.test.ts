import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateDictionaryPayload,
  validateGlobalRulesPayload,
  validatePasswordChangeInput,
  validateTemplatePayload,
  validateWecomVerifyPayload,
} from './validation';

test('validatePasswordChangeInput rejects missing, short, repeated, and oversized passwords', () => {
  assert.deepEqual(validatePasswordChangeInput({ oldPassword: '', newPassword: 'abcdef' }), {
    valid: false,
    error: '请输入当前密码',
  });
  assert.deepEqual(validatePasswordChangeInput({ oldPassword: 'old123', newPassword: '123' }), {
    valid: false,
    error: '新密码长度不能少于6位',
  });
  assert.deepEqual(validatePasswordChangeInput({ oldPassword: 'old123', newPassword: 'old123' }), {
    valid: false,
    error: '新密码不能与当前密码相同',
  });
  assert.equal(validatePasswordChangeInput({ oldPassword: 'old123', newPassword: 'new123' }).valid, true);
});

test('validateTemplatePayload defines required and length rules', () => {
  assert.deepEqual(validateTemplatePayload({ name: '   ' }, 'create'), {
    valid: false,
    error: '模板名称不能为空',
  });
  assert.deepEqual(validateTemplatePayload({ name: 'x'.repeat(101) }, 'create'), {
    valid: false,
    error: '模板名称不能超过100个字符',
  });
  assert.deepEqual(validateTemplatePayload({ name: '督办模板', status: 'UNKNOWN' }, 'create'), {
    valid: false,
    error: '模板状态不合法',
  });
  assert.equal(validateTemplatePayload({ name: '督办模板', status: 'DRAFT' }, 'create').valid, true);
});

test('validateDictionaryPayload requires valid dictionary shape', () => {
  assert.deepEqual(validateDictionaryPayload({ type: 'CATEGORY', label: '', value: 'a' }, 'create'), {
    valid: false,
    error: '字典名称不能为空',
  });
  assert.deepEqual(validateDictionaryPayload({ type: 'UNKNOWN', label: '高优先级', value: 'HIGH' }, 'create'), {
    valid: false,
    error: '字典类型不合法',
  });
  assert.deepEqual(validateDictionaryPayload({ type: 'CATEGORY', label: '高优先级', value: 'HIGH', sortOrder: -1 }, 'create'), {
    valid: false,
    error: '排序号必须为0到9999之间的整数',
  });
  assert.equal(validateDictionaryPayload({ type: 'CATEGORY', label: '高优先级', value: 'HIGH', sortOrder: 1 }, 'create').valid, true);
});

test('validateGlobalRulesPayload validates numeric ranges and callback URL', () => {
  assert.deepEqual(validateGlobalRulesPayload({ autoRemindDays: -1 }), {
    valid: false,
    error: '自动提醒天数必须为0到365之间的整数',
  });
  assert.deepEqual(validateGlobalRulesPayload({ autoUrgeEnabled: 'true' }), {
    valid: false,
    error: 'autoUrgeEnabled必须为布尔值',
  });
  assert.equal(validateGlobalRulesPayload({ autoRemindEnabled: false, autoUrgeEnabled: true }).valid, true);
  assert.deepEqual(validateGlobalRulesPayload({ wecomCallbackUrl: 'ftp://callback' }), {
    valid: false,
    error: '回调URL必须以 http:// 或 https:// 开头',
  });
  assert.equal(validateGlobalRulesPayload({ autoRemindDays: 3, wecomCallbackUrl: 'https://example.com/callback' }).valid, true);
  assert.equal(validateGlobalRulesPayload({ wecomCorpSecret: 's'.repeat(512) }).valid, true);
  assert.deepEqual(validateGlobalRulesPayload({ wecomCorpSecret: 's'.repeat(513) }), {
    valid: false,
    error: '应用Secret不能超过512个字符',
  });
});

test('validateGlobalRulesPayload validates wecom contact chain fields', () => {
  assert.equal(validateGlobalRulesPayload({ wecomContactSecret: 's'.repeat(512) }).valid, true);
  assert.deepEqual(validateGlobalRulesPayload({ wecomContactSecret: 's'.repeat(513) }), {
    valid: false,
    error: '通讯录同步Secret不能超过512个字符',
  });
  assert.equal(validateGlobalRulesPayload({ wecomSyncMode: 'list_id' }).valid, true);
  assert.equal(validateGlobalRulesPayload({ wecomSyncMode: 'legacy' }).valid, true);
  assert.deepEqual(validateGlobalRulesPayload({ wecomSyncMode: 'other' }), {
    valid: false,
    error: '企业微信同步模式必须为 legacy 或 list_id',
  });
  assert.equal(validateGlobalRulesPayload({ wecomPrivateInfoEnabled: true }).valid, true);
  assert.deepEqual(validateGlobalRulesPayload({ wecomPrivateInfoEnabled: 'yes' }), {
    valid: false,
    error: 'wecomPrivateInfoEnabled必须为布尔值',
  });
});

test('validateWecomVerifyPayload requires enterprise callback verification inputs', () => {
  assert.deepEqual(validateWecomVerifyPayload({ wecomToken: 'token', wecomEncodingAesKey: 'short', wecomCallbackUrl: 'https://example.com' }), {
    valid: false,
    error: 'EncodingAESKey必须为43个字符',
  });
  assert.equal(
    validateWecomVerifyPayload({
      wecomToken: 'token',
      wecomEncodingAesKey: 'a'.repeat(43),
      wecomCallbackUrl: 'https://example.com/api/wecom/callback',
    }).valid,
    true,
  );
});
