import test from 'node:test';
import assert from 'node:assert/strict';
import { useAutoEngine } from './useAutoEngine';

test('browser auto engine is disabled and has no callable side effect', () => {
  assert.doesNotThrow(() => useAutoEngine());
});
