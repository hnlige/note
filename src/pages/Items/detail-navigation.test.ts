import test from 'node:test';
import assert from 'node:assert/strict';

import * as detailNavigation from './detail-navigation.ts';

const { getDetailBackNavigation, getMessageIdFromDetailState } = detailNavigation;

test('getDetailBackNavigation prefers the explicit source route from navigation state', () => {
  assert.deepEqual(
    getDetailBackNavigation({ from: '/workbench', label: '返回工作台' }),
    { path: '/workbench', label: '返回工作台' },
  );

  assert.deepEqual(
    getDetailBackNavigation({ from: '/my-items?status=PENDING' }),
    { path: '/my-items?status=PENDING', label: '返回列表' },
  );
});

test('getDetailBackNavigation falls back to the items list for unknown state', () => {
  assert.deepEqual(getDetailBackNavigation(undefined), { path: '/items', label: '返回列表' });
  assert.deepEqual(getDetailBackNavigation({ from: '' }), { path: '/items', label: '返回列表' });
});

test('getDetailPageAuth preserves every trusted whitelisted detail origin', () => {
  const getDetailPageAuth = (detailNavigation as typeof detailNavigation & {
    getDetailPageAuth?: (state?: unknown) => string;
  }).getDetailPageAuth;

  assert.equal(typeof getDetailPageAuth, 'function');
  assert.equal(getDetailPageAuth?.({ from: '/items?status=EXECUTING' }), 'MENU_ITEMS');
  assert.equal(getDetailPageAuth?.({ from: '/my-items?status=PENDING' }), 'MENU_MY_ITEMS');
  assert.equal(getDetailPageAuth?.({ from: '/workbench?filter=mine' }), 'MENU_WORKBENCH');
  assert.equal(getDetailPageAuth?.({ from: '/items/audit?status=REVIEWING' }), 'MENU_AUDIT');
  assert.equal(getDetailPageAuth?.({ from: '/items/recycle-bin?page=2' }), 'MENU_RECYCLE_BIN');
});

test('getDetailPageAuth rejects spoofed or unsupported origins and falls back safely', () => {
  const getDetailPageAuth = (detailNavigation as typeof detailNavigation & {
    getDetailPageAuth?: (state?: unknown) => string;
  }).getDetailPageAuth;

  assert.equal(getDetailPageAuth?.({ from: '/settings/logs' }), 'MENU_ITEMS');
  assert.equal(getDetailPageAuth?.({ from: '/settings/logs?from=/workbench' }), 'MENU_ITEMS');
  assert.equal(getDetailPageAuth?.({ from: '/workbench-extra' }), 'MENU_ITEMS');
  assert.equal(getDetailPageAuth?.({ from: '//example.com/workbench' }), 'MENU_ITEMS');
  assert.equal(getDetailPageAuth?.({ from: 'https://example.com/workbench' }), 'MENU_ITEMS');
  assert.equal(getDetailPageAuth?.(undefined), 'MENU_ITEMS');
});

test('getMessageIdFromDetailState only accepts a non-empty navigation-state message id', () => {
  assert.equal(getMessageIdFromDetailState?.({ messageId: 'message-1' }), 'message-1');
  assert.equal(getMessageIdFromDetailState?.({ messageId: '  ' }), null);
  assert.equal(getMessageIdFromDetailState?.({ messageId: 1 }), null);
  assert.equal(getMessageIdFromDetailState?.(undefined), null);
});

test('detail origin survives refresh through a normalized query parameter', async () => {
  const navigation = await import('./detail-navigation.ts');
  const buildItemDetailUrl = (navigation as typeof navigation & {
    buildItemDetailUrl?: (id: string, pageAuth: string, query?: Record<string, string>) => string;
  }).buildItemDetailUrl;
  const getPageAuthFromQuery = (navigation as typeof navigation & {
    getDetailPageAuthFromQuery?: (value: unknown) => string;
  }).getDetailPageAuthFromQuery;

  assert.equal(typeof buildItemDetailUrl, 'function');
  assert.equal(buildItemDetailUrl?.('item-1', 'MENU_WORKBENCH'), '/items/item-1?origin=MENU_WORKBENCH');
  assert.equal(buildItemDetailUrl?.('item-1', 'MENU_ITEMS', { action: 'urge' }), '/items/item-1?origin=MENU_ITEMS&action=urge');
  assert.equal(getPageAuthFromQuery?.('MENU_MY_ITEMS'), 'MENU_MY_ITEMS');
  assert.equal(getPageAuthFromQuery?.('MENU_LOGS'), 'MENU_ITEMS');
  assert.equal(getPageAuthFromQuery?.(['MENU_WORKBENCH']), 'MENU_ITEMS');
});
