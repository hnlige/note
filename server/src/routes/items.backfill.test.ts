import test from 'node:test';
import assert from 'node:assert/strict';

import { getItemIdentityBackfill } from './items.backfill';
import { filterItemsByAccess } from './access.policy';

test('getItemIdentityBackfill fills missing ownerId and followerId by user names', () => {
  const item = {
    ownerId: null,
    ownerName: '李承办',
    followerId: null,
    followerName: '王跟进',
  };

  const users = [
    { id: '2', name: '李承办', username: 'owner' },
    { id: '3', name: '王跟进', username: 'follower' },
  ];

  assert.deepEqual(getItemIdentityBackfill(item, users), {
    ownerId: '2',
    followerId: '3',
  });
});

test('getItemIdentityBackfill can match by username and ignores existing ids', () => {
  const item = {
    ownerId: 'existing-owner',
    ownerName: 'owner',
    followerId: null,
    followerName: 'follower',
  };

  const users = [
    { id: '2', name: '李承办', username: 'owner' },
    { id: '3', name: '王跟进', username: 'follower' },
  ];

  assert.deepEqual(getItemIdentityBackfill(item, users), {
    followerId: '3',
  });
});

test('getItemIdentityBackfill returns null when no backfill is possible', () => {
  const item = {
    ownerId: null,
    ownerName: '不存在的人',
    followerId: null,
    followerName: null,
  };

  const users = [
    { id: '2', name: '李承办', username: 'owner' },
  ];

  assert.equal(getItemIdentityBackfill(item, users), null);
});

test('backfilled owner identity keeps attachment permission aligned with item detail visibility', () => {
  const item = {
    id: 'item-legacy-owner',
    ownerId: null,
    ownerName: '申林',
    followerId: 'follower-1',
    followerName: '督办专员',
  };
  const users = [
    { id: 'owner-1', name: '申林', username: 'shenlin', status: 'ACTIVE' },
    { id: 'follower-1', name: '督办专员', username: 'follower', status: 'ACTIVE' },
    { id: 'other-1', name: '其他责任人', username: 'other', status: 'ACTIVE' },
  ];
  const role = {
    id: 'owner-role',
    dataScope: 'SELF',
    followerDataScope: undefined,
    permissions: ['MENU_MY_ITEMS'],
    customUserIds: [],
  };
  const identityBackfill = getItemIdentityBackfill(item, users);
  const permissionItem = identityBackfill ? { ...item, ...identityBackfill } : item;

  assert.deepEqual(identityBackfill, { ownerId: 'owner-1' });
  assert.deepEqual(
    filterItemsByAccess([permissionItem], {
      currentUser: users[0],
      currentRole: role,
      users,
    }).map((visible) => visible.id),
    ['item-legacy-owner'],
  );
  assert.deepEqual(
    filterItemsByAccess([permissionItem], {
      currentUser: users[2],
      currentRole: role,
      users,
    }).map((visible) => visible.id),
    [],
  );
});

test('attachment permission normalizes TEXT-stored owner_ids so non-first owners stay visible', async () => {
  const { normalizeItemJsonFields } = await import('./items');

  // 线上 items.owner_ids / follower_ids 是 TEXT 列，查询返回 JSON 字符串而非数组。
  const rawRow = {
    id: 'item-multi-owner',
    ownerId: 'owner-first',
    ownerIds: '["owner-first","owner-shen"]',
    followerId: null,
    followerName: null,
  };
  const users = [
    { id: 'owner-shen', name: '申林', username: '00008164', status: 'ACTIVE' },
    { id: 'owner-first', name: '第一责任人', username: 'first', status: 'ACTIVE' },
  ];
  const role = {
    id: 'owner-role',
    dataScope: 'SELF',
    followerDataScope: undefined,
    permissions: ['MENU_MY_ITEMS'],
    customUserIds: [],
  };
  const accessInput = {
    currentUser: users[0],
    currentRole: role,
    users,
  };

  // 原始行（未规整）在 SELF 范围下会误判为不可见——正是线上附件上传 403 的根因。
  assert.deepEqual(filterItemsByAccess([rawRow as any], accessInput).map((v) => v.id), []);

  const normalized = normalizeItemJsonFields(rawRow as any);
  assert.deepEqual(normalized.ownerIds, ['owner-first', 'owner-shen']);
  assert.deepEqual(filterItemsByAccess([normalized as any], accessInput).map((v) => v.id), ['item-multi-owner']);

  // 规整后仍保留姓名回填路径：缺少 ownerId 但有姓名的行也能被识别。
  const backfill = getItemIdentityBackfill({ ...normalized, ownerId: null, ownerName: '申林' }, users);
  assert.deepEqual(backfill, { ownerId: 'owner-shen' });
});
