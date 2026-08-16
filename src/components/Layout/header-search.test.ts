import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldHideHeaderSearch } from './header-search.ts';

test('shouldHideHeaderSearch hides the global search on every page route', () => {
  assert.equal(shouldHideHeaderSearch('/workbench'), true);
  assert.equal(shouldHideHeaderSearch('/workbench/'), true);
  assert.equal(shouldHideHeaderSearch('/items'), true);
  assert.equal(shouldHideHeaderSearch('/workbench/detail'), true);
  assert.equal(shouldHideHeaderSearch('/settings/config'), true);
  assert.equal(shouldHideHeaderSearch('/settings/org'), true);
});
