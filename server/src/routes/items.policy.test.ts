import test from 'node:test';
import assert from 'node:assert/strict';

import * as policyModule from './items.policy';
import { canManageItems, canUseItemAction, canUseSubTaskMutationAction, getActionForItemUpdate, getInvalidItemUpdateFields, isSubTaskOnlyUpdatePayload, normalizeFollowerSelection, sanitizeItemUpdates, validateItemStatusTransition } from './items.policy';

test('sanitizeItemUpdates keeps only the supported editable item fields', () => {
  const now = new Date('2026-06-15T10:00:00.000Z');
  const result = sanitizeItemUpdates(
    {
      title: '新的标题',
      content: '新的内容',
      deadline: '2026-06-30',
      ownerId: '2',
      ownerName: '李承办',
      meetingSource: '办公会',
      sharedWith: [{ userId: 'u1', userName: '共享用户' }],
      attachments: [{ id: 'a1', name: '附件.pdf' }],
      serialNo: 'should-be-ignored',
      createdAt: 'should-be-ignored',
    },
    now,
  );

  assert.deepEqual(result, {
    title: '新的标题',
    content: '新的内容',
    deadline: new Date('2026-06-30'),
    ownerId: '2',
    ownerName: '李承办',
    meetingSource: '办公会',
    sharedWith: [{ userId: 'u1', userName: '共享用户' }],
    attachments: [{ id: 'a1', name: '附件.pdf' }],
    serialNo: 'should-be-ignored',
    updatedAt: now,
  });
});

test('sanitizeItemUpdates does not persist COS signed URLs', () => {
  const result = sanitizeItemUpdates({
    attachments: [
      { id: 'cos-1', name: '资料.pdf', storageKey: 'duban/attachments/资料.pdf', url: 'https://signed.example/temporary' },
      { id: 'legacy-1', name: '旧附件', url: 'data:text/plain;base64,b2xk' },
    ],
  }, new Date('2026-06-15T10:00:00.000Z'));

  assert.deepEqual(result.attachments, [
    { id: 'cos-1', name: '资料.pdf', storageKey: 'duban/attachments/资料.pdf' },
    { id: 'legacy-1', name: '旧附件', url: 'data:text/plain;base64,b2xk' },
  ]);
});

test('getInvalidItemUpdateFields reports unsupported persisted fields', () => {
  const invalidFields = getInvalidItemUpdateFields({
    timeline: [],
    restartDate: '2026-06-30',
    ownerIds: ['2', '6'],
    lastFeedbackDate: '2026-06-15',
  });

  assert.deepEqual(invalidFields, ['restartDate']);
});

test('canManageItems denies write access to read-only roles', () => {
  assert.equal(
    canManageItems({
      role: 'DEPT_ADMIN',
      roleConfig: {
        permissions: [],
        allowedActions: ['READ', 'SEARCH', 'EXPORT'],
      },
    }),
    false,
  );
});

test('canManageItems treats empty action grants as no write authorization', () => {
  assert.equal(
    canManageItems({
      role: '组织管理员',
      roleConfig: {
        permissions: [],
        allowedActions: [],
      },
    }),
    false,
  );
});

test('canManageItems allows admin-like roles and roles with explicit write actions', () => {
  assert.equal(
    canManageItems({
      role: 'ADMIN',
      roleConfig: {
        permissions: ['ALL'],
        allowedActions: [],
      },
    }),
    true,
  );

  assert.equal(
    canManageItems({
      role: 'FOLLOWER',
      roleConfig: {
        permissions: [],
        allowedActions: ['EDIT_ITEM'],
      },
    }),
    true,
  );
});

test('canManageItems denies malformed allowedActions instead of treating them as legacy unrestricted', () => {
  const malformedValues = [
    '{bad json}',
    'null',
    'EDIT_ITEM',
    ['EDIT_ITEM', 7],
    null,
  ];

  for (const allowedActions of malformedValues) {
    assert.equal(
      canManageItems({
        role: '普通用户',
        roleConfig: { permissions: [], allowedActions },
      }),
      false,
      `malformed allowedActions granted item management: ${JSON.stringify(allowedActions)}`,
    );
  }
});

test('canManageItems denies empty grants and preserves administrator behavior', () => {
  for (const allowedActions of [undefined, [], '[]']) {
    assert.equal(
      canManageItems({
        role: '普通用户',
        roleConfig: { permissions: [], allowedActions },
      }),
      false,
    );
  }

  assert.equal(canManageItems({ role: 'ADMIN', roleConfig: { allowedActions: '{bad json}' } }), true);
  assert.equal(canManageItems({ role: '普通用户', roleConfig: { permissions: ['ALL'], allowedActions: '{bad json}' } }), true);
});

test('normalizeFollowerSelection only allows active follower users and backfills names from users table', () => {
  const users = [
    { id: 'f1', name: '第一督办专员', role: '督办专员', roleId: 'r2', status: 'ACTIVE' },
    { id: 'f2', name: '第二督办专员', role: 'FOLLOWER', roleId: 'r9', status: 'ACTIVE' },
    { id: 'o1', name: '责任人', role: '责任人', roleId: 'r6', status: 'ACTIVE' },
    { id: 'f3', name: '停用专员', role: '督办专员', roleId: 'r2', status: 'INACTIVE' },
  ];

  assert.deepEqual(normalizeFollowerSelection({ followerIds: ['f1', 'f2'], followerNames: ['伪造名称'] }, users, { required: true }), {
    valid: true,
    updates: {
      followerId: 'f1',
      followerName: '第一督办专员',
      followerIds: ['f1', 'f2'],
      followerNames: ['第一督办专员', '第二督办专员'],
    },
  });
  assert.deepEqual(normalizeFollowerSelection({ followerIds: ['o1'] }, users, { required: true }), {
    valid: false,
    error: '只能选择督办专员作为跟进人：责任人',
  });
  assert.deepEqual(normalizeFollowerSelection({ followerIds: ['f3'] }, users, { required: true }), {
    valid: false,
    error: '督办专员账号已停用：停用专员',
  });
});

test('canUseItemAction parses JSON string allowedActions from database rows', () => {
  assert.equal(
    canUseItemAction({
      role: '督办专员',
      roleConfig: {
        permissions: '["MENU_WORKBENCH","MENU_ITEMS"]',
        allowedActions: '["READ","SEARCH","EXPORT","EDIT_ITEM","CREATE_ITEM"]',
      },
      action: 'CREATE_ITEM',
    }),
    true,
  );
});

test('canUseItemAction uses the exact page grant when pageAuth is supplied', () => {
  const roleConfig = {
    permissions: ['MENU_ITEMS'],
    allowedActions: ['READ'],
    allowedPageActions: {
      MENU_ITEMS: ['EDIT_ITEM'],
      MENU_WORKBENCH: ['CREATE_ITEM'],
    },
  };

  assert.equal(canUseItemAction({ role: '督办专员', roleConfig, pageAuth: 'MENU_ITEMS', action: 'EDIT_ITEM' }), true);
  assert.equal(canUseItemAction({ role: '督办专员', roleConfig, pageAuth: 'MENU_ITEMS', action: 'CREATE_ITEM' }), false);
  assert.equal(canUseItemAction({ role: '督办专员', roleConfig: { ...roleConfig, allowedPageActions: '{"MENU_ITEMS":["EDIT_ITEM"]}' }, pageAuth: 'MENU_ITEMS', action: 'EDIT_ITEM' }), true);
});

test('canUseItemAction requires the declared module and exact supported page action', () => {
  const itemsCreator = {
    permissions: ['MENU_ITEMS'],
    allowedActions: ['READ'],
    allowedPageActions: { MENU_ITEMS: ['CREATE_ITEM'] },
  };

  assert.equal(canUseItemAction({ role: '用户', roleConfig: itemsCreator, pageAuth: 'MENU_ITEMS', action: 'CREATE_ITEM' }), true);
  assert.equal(canUseItemAction({ role: '用户', roleConfig: itemsCreator, pageAuth: 'MENU_WORKBENCH', action: 'CREATE_ITEM' }), false);
  assert.equal(canUseItemAction({ role: '用户', roleConfig: itemsCreator, pageAuth: 'MENU_MY_ITEMS', action: 'CREATE_ITEM' }), false);
  assert.equal(canUseItemAction({
    role: '用户',
    roleConfig: {
      permissions: ['MENU_WORKBENCH'],
      allowedActions: ['READ'],
      allowedPageActions: { MENU_ITEMS: ['CREATE_ITEM'] },
    },
    pageAuth: 'MENU_ITEMS',
    action: 'CREATE_ITEM',
  }), false);
});

test('canUseItemAction authorizes workbench-owned sign and feedback without cross-page leakage', () => {
  const workbenchOperator = {
    permissions: ['MENU_WORKBENCH'],
    allowedActions: ['READ'],
    allowedPageActions: { MENU_WORKBENCH: ['SIGN_ITEM', 'FEEDBACK_ITEM'] },
  };

  assert.equal(canUseItemAction({ role: '用户', roleConfig: workbenchOperator, pageAuth: 'MENU_WORKBENCH', action: 'SIGN_ITEM' }), true);
  assert.equal(canUseItemAction({ role: '用户', roleConfig: workbenchOperator, pageAuth: 'MENU_WORKBENCH', action: 'FEEDBACK_ITEM' }), true);
  assert.equal(canUseItemAction({ role: '用户', roleConfig: workbenchOperator, pageAuth: 'MENU_MY_ITEMS', action: 'SIGN_ITEM' }), false);
  assert.equal(canUseItemAction({ role: '用户', roleConfig: workbenchOperator, pageAuth: 'MENU_ITEMS', action: 'FEEDBACK_ITEM' }), false);

  const legacyGlobalOperator = {
    permissions: ['MENU_WORKBENCH'],
    allowedActions: ['SIGN_ITEM', 'FEEDBACK_ITEM'],
  };
  assert.equal(canUseItemAction({ role: '用户', roleConfig: legacyGlobalOperator, pageAuth: 'MENU_WORKBENCH', action: 'SIGN_ITEM' }), true);
  assert.equal(canUseItemAction({ role: '用户', roleConfig: legacyGlobalOperator, pageAuth: 'MENU_WORKBENCH', action: 'FEEDBACK_ITEM' }), true);
});

test('canUseItemAction keeps global legacy actions context-free without cross-page leakage', () => {
  const legacyRole = {
    permissions: ['MENU_ITEMS'],
    allowedActions: ['CREATE_ITEM'],
  };

  assert.equal(canUseItemAction({ role: '用户', roleConfig: legacyRole, action: 'CREATE_ITEM' }), true);
  assert.equal(canUseItemAction({ role: '用户', roleConfig: legacyRole, pageAuth: 'MENU_ITEMS', action: 'CREATE_ITEM' }), true);
  assert.equal(canUseItemAction({ role: '用户', roleConfig: legacyRole, pageAuth: 'MENU_WORKBENCH', action: 'CREATE_ITEM' }), false);
});

test('canUseItemAction preserves ADMIN, ALL, and legacy EDIT_ITEM callers without pageAuth', () => {
  assert.equal(canUseItemAction({ role: 'ADMIN', roleConfig: { allowedActions: [] }, pageAuth: 'MENU_ITEMS', action: 'DELETE_ITEM' }), true);
  assert.equal(canUseItemAction({ role: 'ADMIN', roleConfig: { allowedActions: [] }, pageAuth: 'MENU_MY_ITEMS', action: 'CREATE_ITEM' }), false);
  assert.equal(canUseItemAction({ role: 'ADMIN', roleConfig: { allowedActions: [] }, pageAuth: null, action: 'DELETE_ITEM' }), false);
  assert.equal(canUseItemAction({ role: '用户', roleConfig: { permissions: ['ALL'], allowedActions: ['READ'] }, pageAuth: 'MENU_ITEMS', action: 'DELETE_ITEM' }), true);
  assert.equal(canUseItemAction({ role: '用户', roleConfig: { permissions: ['ALL'], allowedActions: ['READ'] }, pageAuth: null, action: 'DELETE_ITEM' }), false);
  assert.equal(canUseItemAction({ role: '用户', roleConfig: { permissions: [], allowedActions: ['EDIT_ITEM'] }, action: 'CHANGE_ITEM' }), true);
});

// 回归：详情页默认以 MENU_ITEMS 为页面上下文（直接打开 / 刷新 / 来源未映射），
// 必须支持责任人/跟进人的签收、反馈、延期、申请完成动作，否则按钮可见却后端 403。
test('detail page (MENU_ITEMS context) supports owner/follower actions for ADMIN and permitted roles', () => {
  for (const action of ['SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM', 'APPLY_COMPLETE_ITEM']) {
    assert.equal(
      canUseItemAction({ role: 'ADMIN', roleConfig: { allowedActions: [] }, pageAuth: 'MENU_ITEMS', action }),
      true,
      `ADMIN should be able to ${action} on MENU_ITEMS detail page`,
    );
  }

  const permittedRole = {
    permissions: ['MENU_ITEMS'],
    allowedActions: ['READ', 'SEARCH', 'SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM', 'APPLY_COMPLETE_ITEM'],
  };
  for (const action of ['SIGN_ITEM', 'FEEDBACK_ITEM', 'DELAY_ITEM', 'APPLY_COMPLETE_ITEM']) {
    assert.equal(
      canUseItemAction({ role: '用户', roleConfig: permittedRole, pageAuth: 'MENU_ITEMS', action }),
      true,
      `role with ${action} in allowedActions should use it on MENU_ITEMS detail page`,
    );
  }
});

test('canUseItemAction legacy fallback denies malformed global action values', () => {
  const malformedValues = [
    'EDIT_ITEM',
    '{bad json}',
    'null',
    JSON.stringify(JSON.stringify(['EDIT_ITEM'])),
    ['EDIT_ITEM', 7],
    { action: 'EDIT_ITEM' },
    7,
  ];

  for (const allowedActions of malformedValues) {
    assert.equal(
      canUseItemAction({ role: '督办专员', roleConfig: { permissions: [], allowedActions }, action: 'CHANGE_ITEM' }),
      false,
      `malformed allowedActions granted item mutation: ${JSON.stringify(allowedActions)}`,
    );
  }
});

test('canUseItemAction fails closed on null and empty page actions', () => {
  assert.equal(
    canUseItemAction({ role: '督办专员', roleConfig: { permissions: ['MENU_ITEMS'], allowedActions: null }, action: 'EDIT_ITEM' }),
    false,
  );
  assert.equal(
    canUseItemAction({ role: '督办专员', roleConfig: { permissions: ['MENU_ITEMS'], allowedActions: null }, pageAuth: 'MENU_ITEMS', action: 'EDIT_ITEM' }),
    false,
  );

  for (const allowedActions of [undefined, [], '[]']) {
    assert.equal(
      canUseItemAction({ role: '督办专员', roleConfig: { permissions: ['MENU_ITEMS'], allowedActions }, pageAuth: 'MENU_ITEMS', action: 'EDIT_ITEM' }),
      false,
    );
  }
});

test('canUseSubTaskMutationAction allows owner feedback permission and follower change permission for subtask edits', () => {
  assert.equal(
    canUseSubTaskMutationAction({
      role: '责任人',
      roleConfig: {
        permissions: [],
        allowedActions: ['READ', 'SEARCH', 'FEEDBACK_ITEM'],
      },
    }),
    true,
  );

  assert.equal(
    canUseSubTaskMutationAction({
      role: '督办专员',
      roleConfig: {
        permissions: [],
        allowedActions: ['READ', 'SEARCH', 'CHANGE_ITEM'],
      },
    }),
    true,
  );

  assert.equal(
    canUseSubTaskMutationAction({
      role: '部门管理员',
      roleConfig: {
        permissions: [],
        allowedActions: ['READ', 'SEARCH', 'EXPORT'],
      },
    }),
    false,
  );
});

test('getActionForItemUpdate maps sharing, attachments and timeline to their specific permissions', () => {
  assert.equal(getActionForItemUpdate({ sharedWith: [{ userId: 'u1' }] }), 'SHARE_ITEM');
  assert.equal(getActionForItemUpdate({ attachments: [{ id: 'a1', name: '附件.pdf' }] }), 'FEEDBACK_ITEM');
  assert.equal(getActionForItemUpdate({ timeline: [{ id: 't1', type: 'FEEDBACK' }] }), 'FEEDBACK_ITEM');
  assert.equal(getActionForItemUpdate({ timeline: [{ id: 't2', type: 'FOLLOWER_FEEDBACK' }] }), 'CHANGE_ITEM');
  assert.equal(getActionForItemUpdate({
    timeline: [{ id: 't0', type: 'CREATE' }, { id: 't2', type: 'FOLLOWER_FEEDBACK' }],
    attachments: [{ id: 'a1', name: '附件.pdf' }],
  }), 'CHANGE_ITEM');
});

test('getActionForItemUpdate resolves recycle, audit, and urge route actions to catalog actions', () => {
  assert.equal(getActionForItemUpdate({ status: 'EXECUTING' }, 'DELETED'), 'RESTART_ITEM');
  assert.equal(getActionForItemUpdate({ status: 'PENDING' }, 'DELETED'), 'RESTART_ITEM');
  assert.equal(getActionForItemUpdate({ status: 'COMPLETED' }, 'DELETED'), 'RESTART_ITEM');
  assert.equal(getActionForItemUpdate({ status: 'EXECUTING' }, 'DISABLED'), 'RESTART_ITEM');
  assert.equal(getActionForItemUpdate({ status: 'EXECUTING' }, 'REVIEWING'), 'REJECT_ITEM');
  assert.equal(getActionForItemUpdate({
    timeline: [{ id: 't-urge', type: 'URGE', content: '请及时反馈' }],
  }), 'URGE_ITEM');
  assert.equal(getActionForItemUpdate({
    timeline: [
      { id: 't-old-urge', type: 'URGE', content: '历史催办' },
      { id: 't-feedback', type: 'FEEDBACK', content: '最新反馈' },
    ],
    lastFeedbackDate: '2026-08-07',
  }), 'FEEDBACK_ITEM');
});

test('getActionForItemUpdate treats delayed status and planned date changes as delay requests', () => {
  assert.equal(getActionForItemUpdate({ status: 'DELAYED' }, 'OVERDUE'), 'DELAY_ITEM');
  assert.equal(getActionForItemUpdate({ plannedCompletionDate: '2026-07-01' }, 'OVERDUE'), 'DELAY_ITEM');
  assert.equal(getActionForItemUpdate({ deadline: '2026-07-01' }, 'OVERDUE'), 'DELAY_ITEM');
});

test('validateItemStatusTransition requires the completion approval state', () => {
  assert.match(policyModule.validateItemStatusTransition({ status: 'COMPLETED' }, { status: 'EXECUTING' }) || '', /完成申请/);
  assert.equal(policyModule.validateItemStatusTransition({ status: 'COMPLETED' }, { status: 'REVIEWING' }), null);
});

test('getRequiredActionsForItemUpdate keeps every semantic action in composite feedback updates', async () => {
  const policyModule = await import('./items.policy');
  const getRequiredActions = (policyModule as typeof policyModule & {
    getRequiredActionsForItemUpdate?: (payload: Record<string, unknown>, currentStatus?: string | null) => string[];
  }).getRequiredActionsForItemUpdate;

  assert.equal(typeof getRequiredActions, 'function');
  assert.deepEqual(getRequiredActions?.({
    status: 'EXECUTING',
    timeline: [
      { id: 't-old-urge', type: 'URGE', content: '历史催办' },
      { id: 't-feedback', type: 'FEEDBACK', content: '最新反馈' },
    ],
    lastFeedbackDate: '2026-08-07',
    progress: 10,
  }, 'PENDING'), ['SIGN_ITEM', 'FEEDBACK_ITEM']);
  assert.deepEqual(getRequiredActions?.({
    status: 'DELAYED',
    timeline: [{ id: 't-feedback', type: 'FEEDBACK', content: '延期反馈' }],
    progress: 40,
  }, 'OVERDUE'), ['DELAY_ITEM', 'FEEDBACK_ITEM']);
});

test('getRequiredActionsForItemUpdate ignores unchanged status and classifies only appended feedback', async () => {
  const policyModule = await import('./items.policy');
  const getRequiredActions = (policyModule as typeof policyModule & {
    getRequiredActionsForItemUpdate?: (payload: Record<string, unknown>, currentStatus?: string | null) => string[];
  }).getRequiredActionsForItemUpdate;

  assert.equal(typeof getRequiredActions, 'function');
  assert.deepEqual(getRequiredActions?.({
    status: 'EXECUTING',
    timeline: [{ id: 't-feedback', type: 'FEEDBACK', content: '执行中反馈' }],
    progress: 55,
  }, 'EXECUTING'), ['FEEDBACK_ITEM']);
  assert.deepEqual(getRequiredActions?.({
    status: 'DELAYED',
    timeline: [
      { id: 't-old-urge', type: 'URGE', content: '历史催办' },
      { id: 't-feedback', type: 'FEEDBACK', content: '延期中反馈' },
    ],
    lastFeedbackDate: '2026-08-07',
  }, 'DELAYED'), ['FEEDBACK_ITEM']);
  assert.equal(getActionForItemUpdate({
    status: 'EXECUTING',
    timeline: [{ id: 't-feedback', type: 'FEEDBACK', content: '执行中反馈' }],
  }, 'EXECUTING'), 'FEEDBACK_ITEM');
});

test('getRequiredActionsForItemUpdate derives actions from every persisted effect and every new timeline node', async () => {
  const policyModule = await import('./items.policy');
  const getRequiredActions = (policyModule as typeof policyModule & {
    getRequiredActionsForItemUpdate?: (payload: Record<string, unknown>, currentItem?: unknown) => string[];
  }).getRequiredActionsForItemUpdate;
  const currentItem = {
    status: 'PENDING',
    timeline: [{ id: 'existing', type: 'CREATE' }],
  };

  assert.deepEqual(getRequiredActions?.({
    status: 'EXECUTING',
    sharedWith: [{ userId: 'u2' }],
    timeline: [
      { id: 'existing', type: 'CREATE' },
      { id: 'new-sign', type: 'SIGN' },
      { id: 'new-share', type: 'SHARE' },
    ],
  }, currentItem), ['SIGN_ITEM', 'SHARE_ITEM']);

  assert.deepEqual(getRequiredActions?.({
    title: '变更标题',
    timeline: [
      { id: 'existing', type: 'CREATE' },
      { id: 'new-urge', type: 'URGE' },
      { id: 'new-feedback', type: 'FEEDBACK' },
    ],
  }, currentItem), ['URGE_ITEM', 'FEEDBACK_ITEM', 'CHANGE_ITEM']);
});

test('getRequiredActionsForItemUpdate authorizes every client-writable timeline event type', async () => {
  const currentItem = { status: 'EXECUTING', timeline: [] };
  const cases: Array<[string, string]> = [
    ['APPLY_COMPLETE', 'APPLY_COMPLETE_ITEM'],
    ['SATISFIED', 'MARK_UNSATISFIED_ITEM'],
    ['SUSPEND', 'SUSPEND_ITEM'],
    ['DELAY', 'DELAY_ITEM'],
    ['RESTART', 'RESTART_ITEM'],
    ['DISABLE', 'DISABLE_ITEM'],
    ['CREATE', 'CHANGE_ITEM'],
  ];

  for (const [type, action] of cases) {
    assert.deepEqual(policyModule.getRequiredActionsForItemUpdate({
      timeline: [{ id: `new-${type}`, type }],
    }, currentItem), [action]);
  }
});

test('getRequiredActionsForItemUpdate keeps transition bundles narrow', async () => {
  const policyModule = await import('./items.policy');
  const getRequiredActions = (policyModule as typeof policyModule & {
    getRequiredActionsForItemUpdate?: (payload: Record<string, unknown>, currentItem?: unknown) => string[];
  }).getRequiredActionsForItemUpdate;

  assert.deepEqual(getRequiredActions?.({
    status: 'COMPLETED',
    progress: 100,
    subTasks: [{ id: 'st-1', status: 'COMPLETED', progress: 100 }],
  }, { status: 'REVIEWING', timeline: [] }), ['APPROVE_ITEM']);
  assert.deepEqual(getRequiredActions?.({ deadline: '2026-09-01' }, { status: 'EXECUTING' }), ['DELAY_ITEM']);
  assert.deepEqual(getRequiredActions?.({ status: 'REVIEWING' }, { status: 'REVIEWING', timeline: [] }), ['APPROVE_ITEM']);
});

test('validateItemStatusTransition allows UI transitions and rejects spoofed or unknown states', async () => {
  const policyModule = await import('./items.policy');
  const validateTransition = (policyModule as typeof policyModule & {
    validateItemStatusTransition?: (payload: Record<string, unknown>, currentItem: Record<string, unknown>) => string | null;
  }).validateItemStatusTransition;

  assert.equal(typeof validateTransition, 'function');
  assert.equal(validateTransition?.({ status: 'EXECUTING' }, { status: 'DISABLED' }), null);
  assert.equal(validateTransition?.({ status: 'EXECUTING' }, { status: 'DELETED', originalStatus: 'EXECUTING' }), null);
  assert.match(validateTransition?.({ status: 'PENDING' }, { status: 'DELETED', originalStatus: 'EXECUTING' }) || '', /不允许|只能执行恢复/);
  for (const status of ['PENDING', 'OVERDUE', 'ARCHIVED', 'MADE_UP']) {
    assert.match(validateTransition?.({ status }, { status: 'EXECUTING' }) || '', /不允许|无效/);
  }
  for (const status of ['SUSPENDED', 'DELAYED']) {
    assert.match(validateTransition?.({ status: 'COMPLETED' }, { status }) || '', /不允许|完成申请/);
  }
  assert.match(validateTransition?.({ status: 123 }, { status: 'EXECUTING' }) || '', /无效/);
  assert.match(validateTransition?.({ status: 'EXECUTING' }, { status: 'UNKNOWN' }) || '', /状态无效/);
});

test('recycle-bin restoration requires a valid server-side original status and accepts only EXECUTING as intent', () => {
  assert.equal(validateItemStatusTransition(
    { status: 'EXECUTING' },
    { status: 'DELETED', originalStatus: 'PENDING' },
  ), null);
  assert.equal(validateItemStatusTransition(
    { status: 'EXECUTING' },
    { status: 'DELETED', originalStatus: 'OVERDUE' },
  ), null);
  assert.match(validateItemStatusTransition(
    { status: 'PENDING' },
    { status: 'DELETED', originalStatus: 'EXECUTING' },
  ) || '', /只能执行恢复/);
  assert.match(validateItemStatusTransition(
    { status: 'EXECUTING' },
    { status: 'DELETED', originalStatus: 'DELETED' },
  ) || '', /缺少有效原状态/);
});

test('sanitizeItemUpdates rejects client-supplied recycle-bin metadata', () => {
  const result = sanitizeItemUpdates({
    status: 'DELETED',
    originalStatus: 'COMPLETED',
    deletedAt: '2000-01-01T00:00:00.000Z',
    deletedById: 'spoofed-user',
  });

  assert.deepEqual(result, { status: 'DELETED', updatedAt: result.updatedAt });
});

test('isSubTaskOnlyUpdatePayload recognizes subtask-only mutations so owner detail actions can be authorized correctly', () => {
  assert.equal(isSubTaskOnlyUpdatePayload({ subTasks: [{ id: 'st-1', status: 'COMPLETED' }] }), true);
  assert.equal(isSubTaskOnlyUpdatePayload({ subTasks: [{ id: 'st-1', status: 'COMPLETED' }], updatedAt: 'ignored' }), true);
  assert.equal(isSubTaskOnlyUpdatePayload({ subTasks: [{ id: 'st-1', status: 'COMPLETED' }], timeline: [] }), false);
  assert.equal(isSubTaskOnlyUpdatePayload({ title: '新标题' }), false);
});
