import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureAttachmentUploadActorAllowed } from './items';

type ResponseSpy = { status?: number; body?: unknown };

function createResponseSpy(): { response: unknown; state: ResponseSpy } {
  const state: ResponseSpy = {};
  const response = {
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  };
  return { response, state };
}

function createAccessContext(overrides: Record<string, unknown> = {}) {
  return {
    currentUser: { id: 'user-1', name: '操作人', username: 'actor', role: '督办跟进人', roleId: 'r2' },
    currentRole: { permissions: ['MENU_MY_ITEMS'], allowedActions: ['READ', 'FEEDBACK_ITEM'] },
    users: [],
    departments: [],
    ...overrides,
  };
}

test('attachment upload allows pure follower without owner sub-task checks', () => {
  const { response, state } = createResponseSpy();
  const item = {
    ownerIds: ['owner-1'],
    ownerNames: ['责任人'],
    followerIds: ['user-1'],
    followerNames: ['操作人'],
    subTasks: [{ id: 'st-1', assigneeId: 'owner-1', status: 'PENDING' }],
  };
  assert.equal(ensureAttachmentUploadActorAllowed(createAccessContext(), item, response as never), true);
  assert.equal(state.status, undefined);
});

test('attachment upload keeps owner feedback checks: pending sub-task rejected', () => {
  const { response, state } = createResponseSpy();
  const accessContext = createAccessContext({
    currentUser: { id: 'owner-1', name: '责任人', username: 'owner', role: '督办责任人', roleId: 'r6' },
  });
  const item = {
    ownerIds: ['owner-1'],
    ownerNames: ['责任人'],
    subTasks: [{ id: 'st-1', assigneeId: 'owner-1', status: 'PENDING' }],
  };
  assert.equal(ensureAttachmentUploadActorAllowed(accessContext as never, item, response as never), false);
  assert.equal(state.status, 400);
  assert.equal((state.body as { error?: string }).error, '请先签收并填写计划完成日期后再反馈');
});

test('attachment upload allows owner with executing sub-task', () => {
  const { response, state } = createResponseSpy();
  const accessContext = createAccessContext({
    currentUser: { id: 'owner-1', name: '责任人', username: 'owner', role: '督办责任人', roleId: 'r6' },
  });
  const item = {
    ownerIds: ['owner-1'],
    ownerNames: ['责任人'],
    subTasks: [{ id: 'st-1', assigneeId: 'owner-1', status: 'EXECUTING' }],
  };
  assert.equal(ensureAttachmentUploadActorAllowed(accessContext as never, item, response as never), true);
  assert.equal(state.status, undefined);
});

test('attachment upload rejects unrelated actor', () => {
  const { response, state } = createResponseSpy();
  const item = {
    ownerIds: ['owner-1'],
    ownerNames: ['责任人'],
    followerIds: ['follower-1'],
    followerNames: ['跟进人'],
    subTasks: [{ id: 'st-1', assigneeId: 'owner-1', status: 'EXECUTING' }],
  };
  assert.equal(ensureAttachmentUploadActorAllowed(createAccessContext(), item, response as never), false);
  assert.equal(state.status, 403);
  assert.equal((state.body as { error?: string }).error, '仅事项责任人可执行该操作');
});

test('attachment upload allows admin via global privilege', () => {
  const { response, state } = createResponseSpy();
  const accessContext = createAccessContext({
    currentUser: { id: 'admin-1', name: '管理员', username: 'admin', role: 'ADMIN', roleId: 'r1' },
    currentRole: { permissions: ['ALL'], allowedActions: ['READ'] },
  });
  const item = { ownerIds: ['owner-1'], ownerNames: ['责任人'] };
  assert.equal(ensureAttachmentUploadActorAllowed(accessContext as never, item, response as never), true);
  assert.equal(state.status, undefined);
});
