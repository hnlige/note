import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAttachmentObjectKey, getCosConfig, getMaxAttachmentBytes, sanitizeAttachmentName } from './cos';

const env = {
  COS_SECRET_ID: 'id',
  COS_SECRET_KEY: 'key',
  COS_BUCKET: 'duban-1234567890',
  COS_REGION: 'ap-guangzhou',
  COS_PREFIX: 'private/duban',
};

test('COS config is enabled only when all required settings exist', () => {
  assert.equal(getCosConfig({}), null);
  assert.deepEqual(getCosConfig(env), {
    secretId: 'id',
    secretKey: 'key',
    bucket: 'duban-1234567890',
    region: 'ap-guangzhou',
    prefix: 'private/duban',
  });
});

test('attachment names and keys cannot escape the configured prefix', () => {
  assert.equal(sanitizeAttachmentName('../../unsafe?.pdf'), 'unsafe_.pdf');
  const key = buildAttachmentObjectKey(getCosConfig(env)!, 'item-1', '../../unsafe?.pdf', 'attachment-1');
  assert.match(key, /^private\/duban\/attachments\/\d{4}\/\d{2}\/\d{2}\/item-1\/attachment-1-unsafe_\.pdf$/);
});

test('attachment size uses a bounded default and accepts positive configuration', () => {
  assert.equal(getMaxAttachmentBytes({}), 50 * 1024 * 1024);
  assert.equal(getMaxAttachmentBytes({ MAX_ATTACHMENT_BYTES: '2048' }), 2048);
  assert.equal(getMaxAttachmentBytes({ MAX_ATTACHMENT_BYTES: '-1' }), 50 * 1024 * 1024);
  // 配置超过 50MB 上限时被压回上限，避免 env 误配绕过 raw/nginx 层限制。
  assert.equal(getMaxAttachmentBytes({ MAX_ATTACHMENT_BYTES: String(100 * 1024 * 1024) }), 50 * 1024 * 1024);
});
