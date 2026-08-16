import test from 'node:test';
import assert from 'node:assert/strict';

import { getItemIdentityBackfill } from './items.backfill';

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
