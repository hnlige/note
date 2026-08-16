import test from 'node:test';
import assert from 'node:assert/strict';

import { paginateRecycleBinItems } from './recycle-bin-pagination.ts';

test('paginateRecycleBinItems returns the requested page rows and total pages', () => {
  const rows = Array.from({ length: 23 }, (_, index) => `row-${index + 1}`);
  const result = paginateRecycleBinItems(rows, 2, 10);

  assert.equal(result.totalPages, 3);
  assert.equal(result.currentPage, 2);
  assert.deepEqual(result.rows, rows.slice(10, 20));
});

test('paginateRecycleBinItems clamps invalid page values into a safe range', () => {
  const rows = Array.from({ length: 3 }, (_, index) => `row-${index + 1}`);

  assert.deepEqual(paginateRecycleBinItems(rows, 0, 2), {
    totalPages: 2,
    currentPage: 1,
    rows: rows.slice(0, 2),
  });

  assert.deepEqual(paginateRecycleBinItems(rows, 99, 2), {
    totalPages: 2,
    currentPage: 2,
    rows: rows.slice(2, 4),
  });
});
