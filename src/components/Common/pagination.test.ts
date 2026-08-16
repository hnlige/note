import test from 'node:test';
import assert from 'node:assert/strict';

import { paginateItems } from './pagination.ts';

test('paginateItems returns the requested page rows and total pages', () => {
  const rows = Array.from({ length: 23 }, (_, index) => `row-${index + 1}`);
  const result = paginateItems(rows, 2, 10);

  assert.equal(result.totalPages, 3);
  assert.equal(result.currentPage, 2);
  assert.deepEqual(result.rows, rows.slice(10, 20));
});

test('paginateItems clamps invalid page values into a safe range', () => {
  const rows = Array.from({ length: 3 }, (_, index) => `row-${index + 1}`);

  assert.deepEqual(paginateItems(rows, 0, 2), {
    totalPages: 2,
    currentPage: 1,
    rows: rows.slice(0, 2),
  });

  assert.deepEqual(paginateItems(rows, 99, 2), {
    totalPages: 2,
    currentPage: 2,
    rows: rows.slice(2, 4),
  });
});
