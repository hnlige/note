import test from 'node:test';
import assert from 'node:assert/strict';
import { canUseItemAction } from './items.policy';

test('item routes accept only whitelisted single page-auth headers', async () => {
  const itemsModule = await import('./items');
  const resolveItemPageAuth = (itemsModule as typeof itemsModule & {
    resolveItemPageAuth?: (value: unknown) => string | null | undefined;
  }).resolveItemPageAuth;

  assert.equal(typeof resolveItemPageAuth, 'function');
  assert.equal(resolveItemPageAuth?.('MENU_ITEMS'), 'MENU_ITEMS');
  assert.equal(resolveItemPageAuth?.('MENU_MY_ITEMS'), 'MENU_MY_ITEMS');
  assert.equal(resolveItemPageAuth?.('MENU_WORKBENCH'), 'MENU_WORKBENCH');
  assert.equal(resolveItemPageAuth?.('MENU_AUDIT'), 'MENU_AUDIT');
  assert.equal(resolveItemPageAuth?.('MENU_RECYCLE_BIN'), 'MENU_RECYCLE_BIN');
  assert.equal(resolveItemPageAuth?.('MENU_MONITORING'), 'MENU_MONITORING');
  assert.equal(resolveItemPageAuth?.('MENU_MESSAGES'), 'MENU_MESSAGES');
  assert.equal(resolveItemPageAuth?.('MENU_LOGS'), null);
  assert.equal(resolveItemPageAuth?.(['MENU_ITEMS', 'MENU_WORKBENCH']), null);
  assert.equal(resolveItemPageAuth?.(undefined), undefined);
});

test('item route page context accepts exact workbench sign and feedback grants', async () => {
  const { resolveItemPageAuth } = await import('./items');
  const pageAuth = resolveItemPageAuth('MENU_WORKBENCH');
  const roleConfig = {
    permissions: ['MENU_WORKBENCH'],
    allowedActions: ['READ'],
    allowedPageActions: { MENU_WORKBENCH: ['SIGN_ITEM', 'FEEDBACK_ITEM'] },
  };

  assert.equal(canUseItemAction({ role: '用户', roleConfig, pageAuth, action: 'SIGN_ITEM' }), true);
  assert.equal(canUseItemAction({ role: '用户', roleConfig, pageAuth, action: 'FEEDBACK_ITEM' }), true);
  assert.equal(canUseItemAction({ role: '用户', roleConfig, pageAuth: resolveItemPageAuth('MENU_AUDIT'), action: 'SIGN_ITEM' }), false);
});

test('item route requires every action resolved for pending composite feedback', async () => {
  const itemsModule = await import('./items');
  const ensureItemActionsAllowed = (itemsModule as typeof itemsModule & {
    ensureItemActionsAllowed?: (
      accessContext: unknown,
      actions: string[],
      response: unknown,
      payload: Record<string, unknown>,
      pageAuth?: string | null,
    ) => boolean;
  }).ensureItemActionsAllowed;
  const payload = {
    status: 'EXECUTING',
    timeline: [{ id: 't-feedback', type: 'FEEDBACK', content: '首次反馈' }],
    lastFeedbackDate: '2026-08-07',
    progress: 10,
  };
  const makeAccessContext = (allowedPageActions: string[]) => ({
    currentUser: { role: '用户' },
    currentRole: {
      permissions: ['MENU_WORKBENCH'],
      allowedActions: ['READ'],
      allowedPageActions: { MENU_WORKBENCH: allowedPageActions },
    },
  });
  const makeResponse = () => {
    const state: { status?: number; body?: unknown } = {};
    return {
      state,
      response: {
        status(code: number) {
          state.status = code;
          return this;
        },
        json(body: unknown) {
          state.body = body;
          return this;
        },
      },
    };
  };

  assert.equal(typeof ensureItemActionsAllowed, 'function');
  for (const grants of [['SIGN_ITEM'], ['FEEDBACK_ITEM']]) {
    const { response, state } = makeResponse();
    assert.equal(ensureItemActionsAllowed?.(
      makeAccessContext(grants),
      ['SIGN_ITEM', 'FEEDBACK_ITEM'],
      response,
      payload,
      'MENU_WORKBENCH',
    ), false);
    assert.equal(state.status, 403);
  }

  const { response, state } = makeResponse();
  assert.equal(ensureItemActionsAllowed?.(
    makeAccessContext(['SIGN_ITEM', 'FEEDBACK_ITEM']),
    ['SIGN_ITEM', 'FEEDBACK_ITEM'],
    response,
    payload,
    'MENU_WORKBENCH',
  ), true);
  assert.equal(state.status, undefined);
});

test('signing a pending item requires a plan only when no required date exists', async () => {
  const { getPlannedCompletionDateForSign, hasPlannedCompletionDateForSign } = await import('./items');
  const actor = { id: 'owner-1', name: '责任人' };
  const item = { status: 'PENDING', ownerId: 'owner-1', plannedCompletionDate: '' };

  assert.equal(hasPlannedCompletionDateForSign(item, actor, {}), false);
  assert.equal(hasPlannedCompletionDateForSign(item, actor, { plannedCompletionDate: '2026-08-30' }), true);
  assert.equal(hasPlannedCompletionDateForSign(
    { ...item, requiredCompletionDate: '2026-08-30' },
    actor,
    {},
  ), true);
  assert.equal(getPlannedCompletionDateForSign(
    { ...item, requiredCompletionDate: '2026-08-30' },
    actor,
    { plannedCompletionDate: '2026-09-01' },
  ), '2026-08-30', 'required completion date must take precedence over owner input');
});

test('owner activity advances the matching pending subtask after parent already started', async () => {
  const { applyOwnerActivitySubTaskUpdate } = await import('./items');
  const item = {
    status: 'EXECUTING',
    subTasks: [
      { id: 'sub-1', assigneeId: 'owner-1', assigneeName: '魏红义', status: 'PENDING', plannedCompletionDate: '' },
      { id: 'sub-2', assigneeId: 'owner-2', assigneeName: '其他责任人', status: 'EXECUTING', plannedCompletionDate: '2026/08/30' },
    ],
  };

  const updated = applyOwnerActivitySubTaskUpdate(item, { id: 'owner-1', name: '魏红义' }, {
    plannedCompletionDate: '2026/08/31',
  });

  assert.equal(updated?.[0].status, 'EXECUTING');
  assert.equal(updated?.[0].plannedCompletionDate, '2026/08/31');
  assert.equal(updated?.[0].deadline, '2026/08/31');
  assert.equal(updated?.[1].status, 'EXECUTING');
  assert.equal(updated?.[1].plannedCompletionDate, '2026/08/30');
});

test('multi-owner signing checks only the current owner subtask date', async () => {
  const { hasPlannedCompletionDateForSign } = await import('./items');
  const item = {
    status: 'PENDING',
    subTasks: [
      { assigneeId: 'owner-1', status: 'PENDING', plannedCompletionDate: '' },
      { assigneeId: 'owner-2', status: 'PENDING', plannedCompletionDate: '2026-08-30' },
    ],
  };

  assert.equal(hasPlannedCompletionDateForSign(item, { id: 'owner-1' }, {}), false);
  assert.equal(hasPlannedCompletionDateForSign(item, { id: 'owner-1' }, { plannedCompletionDate: '2026-08-31' }), true);
  assert.equal(hasPlannedCompletionDateForSign({
    ...item,
    subTasks: [
      { assigneeId: 'owner-1', status: 'PENDING', plannedCompletionDate: '', requiredCompletionDate: '2026-08-30' },
      item.subTasks[1],
    ],
  }, { id: 'owner-1' }, {}), true);
  assert.equal(hasPlannedCompletionDateForSign(item, { id: 'owner-2' }, {}), true);
  assert.equal(hasPlannedCompletionDateForSign({ ...item, plannedCompletionDate: '2026-09-01' }, { id: 'owner-1' }, {}), false);
});

test('item route transition guard returns 400 before persistence for invalid transitions', async () => {
  const itemsModule = await import('./items');
  const ensureValidTransition = (itemsModule as typeof itemsModule & {
    ensureValidItemStatusTransition?: (currentItem: Record<string, unknown>, payload: Record<string, unknown>, response: unknown) => boolean;
  }).ensureValidItemStatusTransition;
  const state: { status?: number; body?: unknown; persisted: boolean } = { persisted: false };
  const response = {
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  };

  assert.equal(typeof ensureValidTransition, 'function');
  if (ensureValidTransition?.({ status: 'EXECUTING' }, { status: 'ARCHIVED' }, response)) state.persisted = true;
  assert.equal(state.status, 400);
  assert.equal(state.persisted, false);
});

test('approval action still requires an explicit grant when page-auth header is absent', async () => {
  const itemsModule = await import('./items');
  const ensureItemActionsAllowed = (itemsModule as typeof itemsModule & {
    ensureItemActionsAllowed?: (
      accessContext: unknown,
      actions: string[],
      response: unknown,
      payload: Record<string, unknown>,
      pageAuth?: string | null,
    ) => boolean;
  }).ensureItemActionsAllowed;
  const state: { status?: number } = {};
  const response = {
    status(code: number) { state.status = code; return this; },
    json() { return this; },
  };

  const result = ensureItemActionsAllowed?.({
    currentUser: { role: '用户' },
    currentRole: { permissions: ['MENU_AUDIT'], allowedActions: ['READ'] },
  }, ['APPROVE_ITEM'], response, {}, undefined);

  assert.equal(result, false);
  assert.equal(state.status, 403);
});

test('approval action is allowed from MENU_MY_ITEMS for follower role with explicit grant', async () => {
  const { resolveItemPageAuth } = await import('./items');
  const pageAuth = resolveItemPageAuth('MENU_MY_ITEMS');
  const roleConfig = {
    permissions: ['MENU_MY_ITEMS'],
    allowedActions: ['READ', 'APPROVE_ITEM'],
  };

  assert.equal(canUseItemAction({ role: '用户', roleConfig, pageAuth, action: 'APPROVE_ITEM' }), true);
  assert.equal(canUseItemAction({ role: '用户', roleConfig, pageAuth, action: 'REJECT_ITEM' }), false);
});

test('approval action requires explicit page grant from MENU_MY_ITEMS even with global action', async () => {
  const { resolveItemPageAuth } = await import('./items');
  const pageAuth = resolveItemPageAuth('MENU_MY_ITEMS');
  const roleConfig = {
    permissions: ['MENU_MY_ITEMS'],
    allowedActions: ['READ'],
  };

  assert.equal(canUseItemAction({ role: '用户', roleConfig, pageAuth, action: 'APPROVE_ITEM' }), false);
});

test('timeline persistence replaces client audit identity and timestamp with server values', async () => {
  const { buildTrustedTimelineNodes } = await import('./items');
  const serverTime = new Date('2026-08-13T01:02:03.000Z');
  const [node] = buildTrustedTimelineNodes(
    [{ id: 'new-feedback', type: 'FEEDBACK', user: '伪造管理员', timestamp: '2000-01-01', content: '进度反馈' }],
    new Set(),
    { id: 'user-1', name: '当前用户' },
    () => 'generated-id',
    () => serverTime,
  );

  assert.equal(node.user, '当前用户');
  assert.equal(node.actorUserId, 'user-1');
  assert.equal(node.timestamp, serverTime);
});

test('timeline persistence keeps only increments and rejects unknown event types', async () => {
  const { buildTrustedTimelineNodes } = await import('./items');
  const nodes = buildTrustedTimelineNodes(
    [
      { id: 'existing', type: 'FEEDBACK', content: '历史节点' },
      { id: 'new-one', type: 'SIGN', content: '签收' },
      { id: 'client-approval', type: 'APPROVE', content: '伪造审批' },
    ],
    new Set(['existing']),
    { id: 'owner-1', name: '责任人' },
    () => 'generated-id',
  );

  assert.deepEqual(nodes.map((node) => node.type), ['SIGN']);
  assert.throws(() => buildTrustedTimelineNodes(
    [{ id: 'bad', type: 'ARBITRARY_AUDIT', user: '管理员' }],
    new Set(),
    { id: 'owner-1', name: '责任人' },
    () => 'generated-id',
  ), /不支持的时间线事件类型/);
});

test('feedback action rejects owner whose subtask is overdue', async () => {
  const itemsModule = await import('./items');
  const ensureItemActorAllowed = (itemsModule as typeof itemsModule & {
    ensureItemActorAllowed?: (
      accessContext: unknown,
      action: string,
      item: Record<string, unknown>,
      response: unknown,
      payload?: Record<string, unknown>,
    ) => boolean;
  }).ensureItemActorAllowed;

  const state: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  };

  const accessContext = {
    currentUser: { id: 'owner-1', name: '责任人', role: 'OWNER', roleId: 'r-owner' },
    currentRole: { permissions: [], allowedActions: ['READ', 'FEEDBACK_ITEM'] },
  };

  const overdueItem = {
    ownerIds: ['owner-1'],
    ownerNames: ['责任人'],
    subTasks: [
      { id: 'st-1', assigneeId: 'owner-1', assigneeName: '责任人', status: 'OVERDUE' },
    ],
  };

  assert.equal(typeof ensureItemActorAllowed, 'function');
  const result = ensureItemActorAllowed?.(accessContext, 'FEEDBACK_ITEM', overdueItem, response);
  assert.equal(result, false);
  assert.equal(state.status, 400);
  assert.equal((state.body as { error?: string })?.error, '子任务已超时，请先申请延期后再反馈');
});

test('feedback action rejects owner whose subtask is still pending sign-off', async () => {
  const { ensureItemActorAllowed } = await import('./items');
  const state: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  };
  const accessContext = {
    currentUser: { id: 'owner-1', name: '责任人', role: 'OWNER', roleId: 'r-owner' },
    currentRole: { permissions: [], allowedActions: ['READ', 'FEEDBACK_ITEM'] },
  };
  const pendingItem = {
    ownerIds: ['owner-1'],
    ownerNames: ['责任人'],
    subTasks: [{ id: 'st-1', assigneeId: 'owner-1', assigneeName: '责任人', status: 'PENDING' }],
  };

  assert.equal(ensureItemActorAllowed(accessContext, 'FEEDBACK_ITEM', pendingItem, response), false);
  assert.equal(state.status, 400);
  assert.equal((state.body as { error?: string })?.error, '请先签收并填写计划完成日期后再反馈');
});

test('feedback action allows owner whose subtask is executing', async () => {
  const itemsModule = await import('./items');
  const ensureItemActorAllowed = (itemsModule as typeof itemsModule & {
    ensureItemActorAllowed?: (
      accessContext: unknown,
      action: string,
      item: Record<string, unknown>,
      response: unknown,
      payload?: Record<string, unknown>,
    ) => boolean;
  }).ensureItemActorAllowed;

  const state: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  };

  const accessContext = {
    currentUser: { id: 'owner-1', name: '责任人', role: 'OWNER', roleId: 'r-owner' },
    currentRole: { permissions: [], allowedActions: ['READ', 'FEEDBACK_ITEM'] },
  };

  const executingItem = {
    ownerIds: ['owner-1'],
    ownerNames: ['责任人'],
    subTasks: [
      { id: 'st-1', assigneeId: 'owner-1', assigneeName: '责任人', status: 'EXECUTING' },
    ],
  };

  assert.equal(typeof ensureItemActorAllowed, 'function');
  const result = ensureItemActorAllowed?.(accessContext, 'FEEDBACK_ITEM', executingItem, response);
  assert.equal(result, true);
  assert.equal(state.status, undefined);
});
