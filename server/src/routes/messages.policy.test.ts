import test from 'node:test';
import assert from 'node:assert/strict';

import { filterMessagesWithExistingItemLinks, getItemIdFromMessageLink, getLinkedItemIds } from './messages.policy';

test('getItemIdFromMessageLink only extracts plain item detail links', () => {
  assert.equal(getItemIdFromMessageLink('/items/abc-123'), 'abc-123');
  assert.equal(getItemIdFromMessageLink('/items/abc-123?tab=detail'), null);
  assert.equal(getItemIdFromMessageLink('/messages'), null);
  assert.equal(getItemIdFromMessageLink(null), null);
});

test('getLinkedItemIds returns unique item ids referenced by messages', () => {
  assert.deepEqual(
    getLinkedItemIds([
      { link: '/items/i1' },
      { link: '/items/i1' },
      { link: '/items/i2' },
      { link: '/messages' },
      { link: null },
    ]),
    ['i1', 'i2'],
  );
});

test('filterMessagesWithExistingItemLinks removes orphan item-linked messages but keeps non-item messages', () => {
  const messages = [
    { id: 'm1', link: '/items/i1' },
    { id: 'm2', link: '/items/missing' },
    { id: 'm3', link: '/messages' },
    { id: 'm4', link: null },
  ];

  assert.deepEqual(
    filterMessagesWithExistingItemLinks(messages, new Set(['i1'])).map((message) => message.id),
    ['m1', 'm3', 'm4'],
  );
});
