import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, isPasswordHash, verifyPassword } from './auth.password';

test('hashPassword stores a non-plaintext verifiable password', async () => {
  const hash = await hashPassword('admin123');

  assert.notEqual(hash, 'admin123');
  assert.equal(isPasswordHash(hash), true);
  assert.equal(await verifyPassword('admin123', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
});

test('verifyPassword accepts legacy plaintext for migration compatibility', async () => {
  assert.equal(await verifyPassword('123456', '123456'), true);
  assert.equal(await verifyPassword('wrong', '123456'), false);
});
