import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('trusted proxy configuration accepts only local and private proxy hops', async () => {
  const proxyModule = await import('./trust-proxy').catch(() => null) as null | {
    configureTrustedProxy: (app: { set: (name: string, value: unknown) => void }) => void;
  };
  assert.ok(proxyModule);

  let setting: unknown;
  proxyModule?.configureTrustedProxy({
    set(name, value) {
      assert.equal(name, 'trust proxy');
      setting = value;
    },
  });
  assert.equal(setting, 'loopback, linklocal, uniquelocal');

  const indexSource = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(indexSource, /configureTrustedProxy\(app\)/);
});
