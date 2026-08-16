import test from 'node:test';
import assert from 'node:assert/strict';

import { getBulkFeedbackItems, getBulkSignableItems } from './action-bar-actions';
import { SupervisionItem, TimelineNode, User } from '../../../types';

const user = (overrides: Partial<User>): Pick<User, 'id' | 'name' | 'username'> => ({
  id: '',
  name: '',
  username: '',
  ...overrides,
});

const baseItem: SupervisionItem = {
  id: 'item-1',
  serialNo: 'DB-001',
  title: '测试事项',
  content: '测试内容',
  status: 'PENDING',
  deadline: '2026-08-31',
  ownerId: 'owner-primary',
  ownerName: '主责任人',
  ownerIds: ['owner-primary'],
  ownerNames: ['主责任人'],
  followerId: 'follower-1',
  followerName: '跟进人',
  progress: 0,
  category: '测试',
  campus: '总部',
  timeline: [],
};

function item(overrides: Partial<SupervisionItem>): SupervisionItem {
  return {
    ...baseItem,
    ...overrides,
    ownerIds: overrides.ownerIds ?? baseItem.ownerIds,
    ownerNames: overrides.ownerNames ?? baseItem.ownerNames,
    timeline: overrides.timeline ?? [],
  };
}

function signNode(name: string): TimelineNode {
  return { id: 't-' + name, type: 'SIGN', user: name, content: '签收', timestamp: '2026-08-01 10:00' };
}
function feedbackNode(name: string): TimelineNode {
  return { id: 'f-' + name, type: 'FEEDBACK', user: name, content: '反馈', timestamp: '2026-08-02 10:00' };
}

test('getBulkSignableItems includes items where current user is an owner but has not signed', () => {
  const current = user({ id: '00000107', name: '副责任人' });
  const signable = getBulkSignableItems([
    item({
      id: 'signable-secondary',
      ownerId: 'owner-primary',
      ownerIds: ['owner-primary', '00000107'],
      ownerNames: ['主责任人', '副责任人'],
      status: 'PENDING',
    }),
    item({
      id: 'already-signed-by-me',
      ownerId: 'owner-primary',
      ownerIds: ['owner-primary', '00000107'],
      ownerNames: ['主责任人', '副责任人'],
      status: 'EXECUTING',
      timeline: [signNode('副责任人')],
    }),
    item({
      id: 'not-owner',
      ownerId: 'someone-else',
      ownerIds: ['someone-else'],
      ownerNames: ['别人'],
      status: 'PENDING',
    }),
  ], current);

  assert.deepEqual(signable.map(current => current.id), ['signable-secondary']);
});

test('getBulkSignableItems matches owner by name when id is absent', () => {
  const current = user({ id: 'owner-primary', name: '主责任人' });
  const signable = getBulkSignableItems([
    item({
      id: 'name-only-owner',
      ownerId: '',
      ownerIds: [],
      ownerName: '主责任人',
      ownerNames: ['主责任人'],
      status: 'PENDING',
    }),
  ], current);

  assert.deepEqual(signable.map(current => current.id), ['name-only-owner']);
});

test('getBulkFeedbackItems includes owned items that are fully signed with no feedback', () => {
  const current = user({ id: 'owner-primary', name: '主责任人' });
  const feedbackItems = getBulkFeedbackItems([
    item({
      id: 'signed-no-feedback',
      ownerId: 'owner-primary',
      ownerNames: ['主责任人'],
      status: 'EXECUTING',
      timeline: [signNode('主责任人')],
    }),
    item({
      id: 'signed-with-feedback',
      ownerId: 'owner-primary',
      ownerNames: ['主责任人'],
      status: 'EXECUTING',
      timeline: [signNode('主责任人'), feedbackNode('主责任人')],
    }),
    item({
      id: 'partial-signed',
      ownerId: 'owner-primary',
      ownerIds: ['owner-primary', '00000107'],
      ownerNames: ['主责任人', '副责任人'],
      status: 'EXECUTING',
      timeline: [signNode('主责任人')],
    }),
    item({
      id: 'not-owner',
      ownerId: 'someone-else',
      ownerNames: ['别人'],
      status: 'EXECUTING',
      timeline: [signNode('别人')],
    }),
  ], current);

  assert.deepEqual(feedbackItems.map(current => current.id), ['signed-no-feedback']);
});
