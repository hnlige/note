import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canAccessByAuthCodes,
  canUseAllowedAction,
  canUsePageAction,
  getDisplayRoleName,
  getRoleByRoleId,
  getStrictUserAuthCodes,
  mapRoleIdentityToUserRole,
} from './role-access.ts';
import { canUserPerformAction, useStore } from './useStore.ts';
import { Role } from '../types';

const roles: Role[] = [
  {
    id: 'r1',
    name: '系统管理员',
    authCodes: ['ALL'],
    dataScope: 'ALL',
    allowedActions: [],
  },
  {
    id: 'r2',
    name: '部门管理员',
    authCodes: ['MENU_ITEMS', 'MENU_MY_ITEMS'],
    dataScope: 'SELF_AND_DIRECT_SUBORDINATES',
    allowedActions: ['READ', 'SEARCH', 'EXPORT'],
  },
];

test('getRoleByRoleId returns null for missing roleId or invalid roleId', () => {
  assert.equal(getRoleByRoleId(undefined, roles), null);
  assert.equal(getRoleByRoleId('missing', roles), null);
});

test('getStrictUserAuthCodes only returns codes from a valid role config', () => {
  assert.deepEqual(getStrictUserAuthCodes({ roleId: undefined }, roles), []);
  assert.deepEqual(getStrictUserAuthCodes({ roleId: 'r2' }, roles), ['MENU_ITEMS', 'MENU_MY_ITEMS']);
});

test('canAccessByAuthCodes denies access when user role config is invalid', () => {
  assert.equal(canAccessByAuthCodes({ roleId: undefined }, roles, ['MENU_ITEMS']), false);
  assert.equal(canAccessByAuthCodes({ roleId: 'r2' }, roles, ['MENU_ITEMS']), true);
});

test('getStrictUserAuthCodes supports stringified roleIds from persisted or remote data', () => {
  assert.deepEqual(getStrictUserAuthCodes({ roleIds: '["r2"]' } as any, roles), ['MENU_ITEMS', 'MENU_MY_ITEMS']);
});

test('canUseAllowedAction no longer falls back to legacy role names', () => {
  assert.equal(canUseAllowedAction({ roleId: undefined }, roles, 'EDIT_ITEM'), false);
  assert.equal(canUseAllowedAction({ roleId: 'r2' }, roles, 'EDIT_ITEM'), false);
  assert.equal(canUseAllowedAction({ roleId: 'r1' }, roles, 'EDIT_ITEM'), true);
});

test('canUsePageAction allows legacy EXPORT on every configured export page', () => {
  assert.equal(canUsePageAction({ roleId: 'r2' }, roles, 'MENU_ITEMS', 'EXPORT'), true);
  assert.equal(canUsePageAction({ roleId: 'r2' }, roles, 'MENU_STATISTICS', 'EXPORT'), true);
  assert.equal(canUsePageAction({ roleId: 'r2' }, roles, 'MENU_MY_ITEMS', 'EXPORT'), false);
});

test('canUsePageAction rejects unsupported actions for unrestricted roles', () => {
  const unrestrictedRoles: Role[] = [
    { id: 'missing-actions', name: '未配置操作权限', authCodes: ['MENU_MY_ITEMS'], dataScope: 'SELF' },
    { id: 'empty-actions', name: '空操作权限', authCodes: ['MENU_MY_ITEMS'], dataScope: 'SELF', allowedActions: [] },
  ];

  assert.equal(canUsePageAction({ roleId: 'missing-actions' }, unrestrictedRoles, 'MENU_MY_ITEMS', 'EXPORT'), false);
  assert.equal(canUsePageAction({ roleId: 'empty-actions' }, unrestrictedRoles, 'MENU_MY_ITEMS', 'EXPORT'), false);
});

test('canUsePageAction does not grant page actions for unrestricted (empty) roles', () => {
  const unrestrictedRoles: Role[] = [
    { id: 'missing-actions', name: '未配置操作权限', authCodes: ['MENU_ITEMS'], dataScope: 'SELF' },
    { id: 'empty-actions', name: '空操作权限', authCodes: ['MENU_ITEMS'], dataScope: 'SELF', allowedActions: [] },
  ];

  // 空/未配置全局操作权限表示“无按钮授权”，不再等同于“全部允许”，
  // 必须显式配置 allowedPageActions 或拥有 ALL 才会授予页面按钮。
  assert.equal(canUsePageAction({ roleId: 'missing-actions' }, unrestrictedRoles, 'MENU_ITEMS', 'EXPORT'), false);
  assert.equal(canUsePageAction({ roleId: 'empty-actions' }, unrestrictedRoles, 'MENU_ITEMS', 'EXPORT'), false);
});

test('canUsePageAction applies catalog limits to ALL roles', () => {
  const allRoles: Role[] = [
    {
      id: 'all-role',
      name: '全权限角色',
      authCodes: ['ALL'],
      dataScope: 'ALL',
      allowedActions: ['READ'],
    },
  ];

  assert.equal(canUsePageAction({ roleId: 'all-role' }, allRoles, 'MENU_ITEMS', 'EXPORT'), true);
  assert.equal(canUsePageAction({ roleId: 'all-role' }, allRoles, 'MENU_MY_ITEMS', 'EXPORT'), false);
});

test('canUsePageAction supports page-specific action grants', () => {
  const pageRoles: Role[] = [
    {
      id: 'page-role',
      name: '页面导出角色',
      authCodes: ['MENU_ITEMS', 'MENU_STATISTICS'],
      dataScope: 'SELF',
      allowedActions: ['READ', 'SEARCH'],
      allowedPageActions: { MENU_ITEMS: ['EXPORT'] },
    },
  ];
  assert.equal(canUsePageAction({ roleId: 'page-role' }, pageRoles, 'MENU_ITEMS', 'EXPORT'), true);
  assert.equal(canUsePageAction({ roleId: 'page-role' }, pageRoles, 'MENU_STATISTICS', 'EXPORT'), false);
});

test('canUsePageAction respects explicit allowedPageActions for built-in admin (ALL) role', () => {
  const adminRoles: Role[] = [
    {
      id: 'r1',
      name: '超级管理员',
      authCodes: ['ALL'],
      dataScope: 'ALL',
      allowedActions: ['READ', 'SEARCH', 'EXPORT', 'CREATE_ITEM'],
      // 显式收口内置管理员的“发起督办”按钮，验证放开后的按钮配置真实生效。
      allowedPageActions: { MENU_WORKBENCH: ['READ', 'EXPORT'] },
    },
  ];

  assert.equal(canUsePageAction({ roleId: 'r1' }, adminRoles, 'MENU_WORKBENCH', 'READ'), true);
  assert.equal(canUsePageAction({ roleId: 'r1' }, adminRoles, 'MENU_WORKBENCH', 'EXPORT'), true);
  // 即便 authCodes 含 ALL，未在该页面显式配置的按钮也会被收口。
  assert.equal(canUsePageAction({ roleId: 'r1' }, adminRoles, 'MENU_WORKBENCH', 'CREATE_ITEM'), false);
});

test('canUsePageAction still grants all buttons for built-in admin when allowedPageActions unset', () => {
  const adminRoles: Role[] = [
    { id: 'r1', name: '超级管理员', authCodes: ['ALL'], dataScope: 'ALL', allowedActions: [] },
  ];
  assert.equal(canUsePageAction({ roleId: 'r1' }, adminRoles, 'MENU_WORKBENCH', 'CREATE_ITEM'), true);
  assert.equal(canUsePageAction({ roleId: 'r1' }, adminRoles, 'MENU_ITEMS', 'EXPORT'), true);
});

test('canUsePageAction uses a union across multiple roles', () => {
  const pageRoles: Role[] = [
    { id: 'items', name: '事项导出', authCodes: ['MENU_ITEMS'], dataScope: 'SELF', allowedActions: ['READ'], allowedPageActions: { MENU_ITEMS: ['EXPORT'] } },
    { id: 'stats', name: '台账导出', authCodes: ['MENU_STATISTICS'], dataScope: 'SELF', allowedActions: ['READ'], allowedPageActions: { MENU_STATISTICS: ['EXPORT'] } },
  ];
  assert.equal(canUsePageAction({ roleIds: ['items', 'stats'] }, pageRoles, 'MENU_ITEMS', 'EXPORT'), true);
  assert.equal(canUsePageAction({ roleIds: ['items', 'stats'] }, pageRoles, 'MENU_STATISTICS', 'EXPORT'), true);
});

test('getDisplayRoleName resolves renamed built-in role names from roleId', () => {
  assert.equal(
    getDisplayRoleName(
      { role: '责任人', roleId: 'r6' } as any,
      [
        ...roles,
        { id: 'r6', name: '督办责任人', authCodes: [], dataScope: 'SELF', allowedActions: ['READ'] },
      ],
    ),
    '督办责任人',
  );
});

test('mapRoleIdentityToUserRole keeps renamed built-in roles loggable by roleId', () => {
  assert.equal(mapRoleIdentityToUserRole({ role: '综合责任岗', roleId: 'r6' } as any), 'OWNER');
  assert.equal(mapRoleIdentityToUserRole({ role: '综合跟进岗', roleId: 'r2' } as any), 'FOLLOWER');
  assert.equal(mapRoleIdentityToUserRole({ role: '业务督办岗', roleId: 'r4dtsn6m' } as any), 'ADMIN');
});

test('setUserRole makes backend-authenticated users available for action checks', () => {
  const previousState = useStore.getState();

  try {
    useStore.setState({
      ...previousState,
      roles: [
        {
          id: 'r6',
          name: '责任人',
          authCodes: ['MENU_MY_ITEMS'],
          dataScope: 'SELF',
          allowedActions: ['READ', 'SIGN_ITEM', 'FEEDBACK_ITEM'],
        },
      ],
      orgUsers: [],
    });

    useStore.getState().setUserRole(
      'OWNER',
      'remote-owner-1',
      '真实责任人',
      'r6',
      ['r6'],
      'dept-1',
      'org-1',
      [],
    );

    const state = useStore.getState();
    assert.equal(
      canUserPerformAction('remote-owner-1', state.orgUsers, state.roles, 'SIGN_ITEM'),
      true,
    );
  } finally {
    useStore.setState(previousState, true);
  }
});

test('setUserRole clears user-scoped cached items when switching accounts', () => {
  const previousState = useStore.getState();

  try {
    useStore.setState({
      ...previousState,
      currentUser: {
        id: 'org-admin-1',
        name: '组织管理员',
        role: 'FOLLOWER',
        roleId: 'r5',
        roleIds: ['r5'],
      },
      items: [
        {
          id: 'cross-org-item',
          serialNo: 'PW-CACHE-001',
          title: '旧账号缓存事项',
          content: 'should be cleared on user switch',
          status: 'EXECUTING',
          deadline: '2026-06-30',
          ownerId: 'owner-1',
          ownerName: '责任人',
          followerId: 'org-admin-1',
          followerName: '组织管理员',
          progress: 50,
          lightStatus: 'GREEN',
          category: '自动化测试',
          campus: '测试院区',
          timeline: [],
        },
      ],
      messages: [
        {
          id: 'msg-1',
          title: '旧消息',
          content: '旧账号的消息缓存',
          type: 'NOTICE',
          timestamp: '2026-06-19 10:00:00',
          read: false,
          link: '/items/cross-org-item',
        },
      ],
      urgeRecords: [
        {
          id: 'urge-1',
          itemId: 'cross-org-item',
          itemTitle: '旧账号缓存事项',
          sender: '组织管理员',
          senderId: 'org-admin-1',
          receiver: '责任人',
          receiverId: 'owner-1',
          status: 'UNREAD',
          method: 'SYSTEM',
          timestamp: '2026-06-19 10:00:00',
        },
      ],
    });

    useStore.getState().setUserRole(
      'OWNER',
      'dept-admin-1',
      '部门管理员',
      'r3',
      ['r3'],
      'dept-1',
      'org-1',
      [],
    );

    const state = useStore.getState();
    assert.deepEqual(state.items, []);
    assert.deepEqual(state.messages, []);
    assert.deepEqual(state.urgeRecords, []);
  } finally {
    useStore.setState(previousState, true);
  }
});
