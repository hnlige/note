import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isMessageVisibleToCurrentUser,
  getVisibleMessages,
  getUnreadVisibleMessageCount,
  normalizeVisibleMessageContent,
} from './message-visibility';
import { Message } from '../types';

const adminUser = { id: '1', role: 'ADMIN', name: '张管理' };
const ownerUser = { id: '2', role: 'OWNER', name: '李承办' };
const followerUser = { id: '3', role: 'FOLLOWER', name: '王跟进' };

test('isMessageVisibleToCurrentUser: 广播消息所有人可见', () => {
  const broadcastMsg = { receiverId: undefined, receiverName: undefined } as any;
  assert.equal(isMessageVisibleToCurrentUser(broadcastMsg, adminUser), true);
  assert.equal(isMessageVisibleToCurrentUser(broadcastMsg, ownerUser), true);
  assert.equal(isMessageVisibleToCurrentUser(broadcastMsg, followerUser), true);
});

test('isMessageVisibleToCurrentUser: 管理员可见全部', () => {
  const msg = { receiverId: '2', receiverName: '李承办' } as any;
  assert.equal(isMessageVisibleToCurrentUser(msg, adminUser), true);
});

test('isMessageVisibleToCurrentUser: 有 receiverId 时按 ID 优先', () => {
  const msgToOwner = { receiverId: '2', receiverName: '李承办' } as any;
  assert.equal(isMessageVisibleToCurrentUser(msgToOwner, ownerUser), true);
  assert.equal(isMessageVisibleToCurrentUser(msgToOwner, followerUser), false);
});

test('isMessageVisibleToCurrentUser: 仅有 receiverName 时按姓名兜底', () => {
  const legacyMsg = { receiverId: undefined, receiverName: '李承办' } as any;
  assert.equal(isMessageVisibleToCurrentUser(legacyMsg, ownerUser), true);
  assert.equal(isMessageVisibleToCurrentUser(legacyMsg, followerUser), false);
});

test('normalizeVisibleMessageContent: 清理历史催办 undefined 内容', () => {
  assert.equal(
    normalizeVisibleMessageContent('您负责的【DB-2026-0624】收到来自黎敏的催办：undefined'),
    '您负责的【DB-2026-0624】收到来自黎敏的催办：请及时查看并反馈处理进展。',
  );
});

test('getVisibleMessages: 只返回当前用户可见的消息', () => {
  const messages = [
    { id: 'm1', receiverId: undefined, receiverName: undefined } as Message, // 广播
    { id: 'm2', receiverId: '2', receiverName: '李承办' } as Message,        // 给 owner
    { id: 'm3', receiverId: '3', receiverName: '王跟进' } as Message,        // 给 follower
  ];

  const ownerVisible = getVisibleMessages(messages, ownerUser);
  assert.equal(ownerVisible.length, 2);
  assert(ownerVisible.find((m) => m.id === 'm1'));
  assert(ownerVisible.find((m) => m.id === 'm2'));

  const followerVisible = getVisibleMessages(messages, followerUser);
  assert.equal(followerVisible.length, 2);
  assert(followerVisible.find((m) => m.id === 'm1'));
  assert(followerVisible.find((m) => m.id === 'm3'));

  const adminVisible = getVisibleMessages(messages, adminUser);
  assert.equal(adminVisible.length, 3);
});

test('getVisibleMessages: 隐藏系统通知消息（默认行为，通知中心/消息中心默认不含 NOTICE）', () => {
  const messages = [
    { id: 'm1', type: 'NOTICE', receiverId: undefined, receiverName: undefined, read: false } as Message,
    { id: 'm2', type: 'TODO', receiverId: '2', receiverName: '李承办', read: false } as Message,
    { id: 'm3', type: 'URGE', receiverId: '2', receiverName: '李承办', read: false } as Message,
  ];

  assert.deepEqual(getVisibleMessages(messages, ownerUser).map((m) => m.id), ['m2', 'm3']);
  assert.equal(getUnreadVisibleMessageCount(messages, ownerUser), 2);
});

test('getVisibleMessages: includeNotice 时消息列表展示系统通知', () => {
  const messages = [
    { id: 'm1', type: 'NOTICE', receiverId: undefined, receiverName: undefined, read: false } as Message,
    { id: 'm2', type: 'TODO', receiverId: '2', receiverName: '李承办', read: false } as Message,
    { id: 'm3', type: 'URGE', receiverId: '2', receiverName: '李承办', read: false } as Message,
  ];

  const visible = getVisibleMessages(messages, ownerUser, undefined, { includeNotice: true });
  assert.deepEqual(visible.map((m) => m.id), ['m1', 'm2', 'm3']);
  // 系统通知分类下的未读数
  assert.equal(visible.filter((m) => m.type === 'NOTICE' && !m.read).length, 1);
});

test('getVisibleMessages: 跟进人也能在消息列表看到广播的系统通知', () => {
  const messages = [
    { id: 'm1', type: 'NOTICE', receiverId: undefined, receiverName: undefined, read: false } as Message,
    { id: 'm2', type: 'TODO', receiverId: '3', receiverName: '王跟进', read: false } as Message,
  ];

  const followerVisible = getVisibleMessages(messages, followerUser, undefined, { includeNotice: true });
  assert.deepEqual(followerVisible.map((m) => m.id), ['m1', 'm2']);
});

test('getVisibleMessages: 过滤关联事项不存在的消息', () => {
  const messages = [
    { id: 'm1', receiverId: '2', receiverName: '李承办', link: '/items/i1' } as Message,
    { id: 'm2', receiverId: '2', receiverName: '李承办', link: '/items/missing' } as Message,
    { id: 'm3', receiverId: '2', receiverName: '李承办', link: '/messages' } as Message,
    { id: 'm4', receiverId: '2', receiverName: '李承办' } as Message,
  ];

  const ownerVisible = getVisibleMessages(messages, ownerUser, [{ id: 'i1' }]);

  assert.deepEqual(ownerVisible.map((m) => m.id), ['m1', 'm3', 'm4']);
});

test('getUnreadVisibleMessageCount: 只统计当前用户可见的未读', () => {
  const messages = [
    { id: 'm1', receiverId: undefined, receiverName: undefined, read: true } as Message,
    { id: 'm2', receiverId: '2', receiverName: '李承办', read: false } as Message,
    { id: 'm3', receiverId: '3', receiverName: '王跟进', read: false } as Message,
  ];

  assert.equal(getUnreadVisibleMessageCount(messages, ownerUser), 1); // m2 未读且可见
  assert.equal(getUnreadVisibleMessageCount(messages, followerUser), 1); // m3 未读且可见
  assert.equal(getUnreadVisibleMessageCount(messages, adminUser), 2); // 两个未读均可见
});

test('getUnreadVisibleMessageCount: 不统计孤儿事项消息', () => {
  const messages = [
    { id: 'm1', receiverId: '2', receiverName: '李承办', link: '/items/i1', read: false } as Message,
    { id: 'm2', receiverId: '2', receiverName: '李承办', link: '/items/missing', read: false } as Message,
  ];

  assert.equal(getUnreadVisibleMessageCount(messages, ownerUser, [{ id: 'i1' }]), 1);
});
