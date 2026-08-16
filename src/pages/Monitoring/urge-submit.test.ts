import test from 'node:test';
import assert from 'node:assert/strict';

import { getUrgeSubmitWarning } from './urge-submit.ts';

test('getUrgeSubmitWarning requires selecting an urge item before submit', () => {
  assert.equal(
    getUrgeSubmitWarning({ itemId: '', content: '请尽快反馈' }),
    '请选择催办事项',
  );
});

test('getUrgeSubmitWarning allows submit flow to continue when an item is selected', () => {
  assert.equal(
    getUrgeSubmitWarning({ itemId: 'item-1', content: '请尽快反馈' }),
    null,
  );
});
