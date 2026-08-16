import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPagination, getPageRequest } from './pagination';

test('pagination clamps invalid input and page size', () => {
  assert.deepEqual(getPageRequest({ page: '0', pageSize: '999' }, 50, 200), { page: 1, pageSize: 200 });
  assert.deepEqual(getPageRequest({ page: '3', pageSize: '25' }, 50, 200), { page: 3, pageSize: 25 });
});

test('pagination reports a stable response shape', () => {
  assert.deepEqual(buildPagination({ page: 2, pageSize: 50 }, 125), {
    page: 2,
    pageSize: 50,
    total: 125,
    totalPages: 3,
  });
});
