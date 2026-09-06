import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterItemsByAccess,
  filterUsersByAccess,
  getValidRoleForUser,
  hasAnyPermission,
} from './access.policy';
import { hasPageAction } from './module-authz';

const roles = [
  {
    id: 'r-self',
    name: '责任人',
    permissions: ['MENU_ITEMS'],
    dataScope: 'SELF',
    followerDataScope: undefined,
    orgIds: [],
    customUserIds: [],
  },
  {
    id: 'r-multi-org',
    name: '组织管理员',
    permissions: ['MENU_ITEMS'],
    dataScope: 'MULTI_ORG',
    followerDataScope: 'MULTI_ORG',
    orgIds: ['org-a'],
    customUserIds: [],
  },
  {
    id: 'r-multi-org-owner',
    name: '责任人组织管理员',
    permissions: ['MENU_ITEMS'],
    dataScope: 'MULTI_ORG',
    followerDataScope: undefined,
    orgIds: ['org-a'],
    customUserIds: [],
  },
  {
    id: 'r-multi-org-follower',
    name: '跟进人组织管理员',
    permissions: ['MENU_ITEMS'],
    dataScope: 'SELF',
    followerDataScope: 'MULTI_ORG',
    orgIds: ['org-a'],
    customUserIds: [],
  },
  {
    id: 'r-sub',
    name: '督办专员',
    permissions: ['MENU_ITEMS'],
    dataScope: 'SELF_AND_DIRECT_SUBORDINATES',
    followerDataScope: 'SELF',
    orgIds: [],
    customUserIds: [],
  },
  {
    id: 'r-dept',
    name: '部门管理员',
    permissions: ['MENU_ITEMS'],
    dataScope: 'DEPT',
    followerDataScope: 'DEPT',
    orgIds: [],
    customUserIds: [],
  },
  {
    id: 'r-dept-owner',
    name: '部门管理员',
    permissions: ['MENU_ITEMS'],
    dataScope: 'DEPT',
    followerDataScope: 'SELF',
    orgIds: [],
    ownerCustomUserIds: ['4'],
    followerCustomUserIds: [],
    customUserIds: [],
  },
  {
    id: 'r-dept-follower',
    name: '部门管理员',
    permissions: ['MENU_ITEMS'],
    dataScope: 'SELF',
    followerDataScope: 'DEPT',
    orgIds: [],
    ownerCustomUserIds: [],
    followerCustomUserIds: ['4'],
    customUserIds: [],
  },
  {
    id: 'r-owner-split',
    name: '责任人指定人员',
    permissions: ['MENU_ITEMS'],
    dataScope: 'DEPT',
    followerDataScope: undefined,
    orgIds: [],
    ownerCustomUserIds: ['owner-a'],
    followerCustomUserIds: [],
    customUserIds: [],
  },
  {
    id: 'r-follower-split',
    name: '跟进人指定人员',
    permissions: ['MENU_ITEMS'],
    dataScope: 'SELF',
    followerDataScope: 'DEPT',
    orgIds: [],
    ownerCustomUserIds: [],
    followerCustomUserIds: ['follower-b'],
    customUserIds: [],
  },
];

const users = [
  { id: '6', role: '部门管理员', roleId: 'r-dept-owner', orgId: 'org-b', deptId: 'dept-1', supervisorId: null, status: 'ACTIVE' },
  { id: '2', role: '责任人', roleId: 'r-self', orgId: 'org-a', deptId: 'dept-1', supervisorId: '6', status: 'ACTIVE' },
  { id: '3', role: '责任人', roleId: 'r-self', orgId: 'org-a', deptId: 'dept-1', supervisorId: '6', status: 'ACTIVE' },
  { id: '4', role: '责任人', roleId: 'r-self', orgId: 'org-c', deptId: 'dept-2', supervisorId: null, status: 'ACTIVE' },
  { id: '7', role: '责任人', roleId: 'r-self', orgId: 'org-b', deptId: 'dept-1', supervisorId: '6', status: 'ACTIVE' },
  { id: '8', role: '责任人', roleId: 'r-self', orgId: 'org-c', deptId: 'dept-3', supervisorId: '2', status: 'ACTIVE' },
];

test('getValidRoleForUser returns null for missing or invalid roleId', () => {
  assert.equal(getValidRoleForUser({ id: 'u1' }, roles), null);
  assert.equal(getValidRoleForUser({ id: 'u1', roleId: 'missing' }, roles), null);
});

test('getValidRoleForUser supports stringified roleIds from historical rows', () => {
  assert.equal(getValidRoleForUser({ id: 'u1', roleIds: '["r-self"]' } as any, roles)?.id, 'r-self');
});

test('getValidRoleForUser preserves valid role ids when a legacy array contains invalid members', () => {
  assert.equal(getValidRoleForUser({ id: 'u1', roleIds: ['r-self', null] }, roles)?.id, 'r-self');
});

test('getValidRoleForUser preserves split custom users when merging multiple roles', () => {
  const merged = getValidRoleForUser({ id: 'u1', roleIds: ['r-owner-split', 'r-follower-split'] } as any, roles);

  assert.deepEqual(merged?.ownerCustomUserIds, ['owner-a']);
  assert.deepEqual(merged?.followerCustomUserIds, ['follower-b']);
  assert.deepEqual(merged?.customUserIds, ['owner-a', 'follower-b']);
});

test('getValidRoleForUser unions object and JSON page-action maps across roles', () => {
  const merged = getValidRoleForUser(
    { id: 'u-page', roleIds: ['page-items', 'page-stats'] } as any,
    [
      { id: 'page-items', name: '事项导出', permissions: ['MENU_ITEMS'], dataScope: 'SELF', allowedActions: ['READ'], allowedPageActions: { MENU_ITEMS: ['EXPORT'] } },
      { id: 'page-stats', name: '台账导出', permissions: ['MENU_STATISTICS'], dataScope: 'SELF', allowedActions: ['READ'], allowedPageActions: '{"MENU_STATISTICS":["EXPORT"]}' },
    ] as any,
  );

  assert.deepEqual((merged as any)?.allowedPageActions, {
    MENU_ITEMS: ['EXPORT'],
    MENU_STATISTICS: ['EXPORT'],
  });
  assert.deepEqual((merged as any)?.allowedActions, ['READ']);
});

test('getValidRoleForUser ignores an empty action grant when merging multiple roles', () => {
  const merged = getValidRoleForUser(
    { id: 'u-empty-grant', roleIds: ['page-read', 'page-empty'] } as any,
    [
      { id: 'page-read', permissions: ['MENU_ITEMS'], dataScope: 'SELF', allowedActions: ['READ', 'EXPORT'], allowedPageActions: { MENU_ITEMS: ['EXPORT'] } },
      { id: 'page-empty', permissions: ['MENU_STATISTICS'], dataScope: 'SELF', allowedActions: [], allowedPageActions: '{"MENU_STATISTICS":["EXPORT"]}' },
    ] as any,
  );

  assert.deepEqual((merged as any)?.allowedActions, ['READ', 'EXPORT']);
  assert.equal(hasPageAction(merged, 'MENU_ITEMS', 'EXPORT'), true);
  assert.equal(hasPageAction(merged, 'MENU_ITEMS', 'READ'), true);
  assert.deepEqual((merged as any)?.allowedPageActions, {
    MENU_ITEMS: ['EXPORT'],
    MENU_STATISTICS: ['EXPORT'],
  });
});

test('getValidRoleForUser does not turn malformed global actions into grants', () => {
  const malformedValues = [
    'EXPORT',
    '{bad json}',
    'null',
    JSON.stringify(JSON.stringify(['EXPORT'])),
    ['EXPORT', 7],
    { action: 'EXPORT' },
    7,
  ];

  for (const [index, allowedActions] of malformedValues.entries()) {
    const merged = getValidRoleForUser(
      { id: `u-malformed-${index}`, roleIds: ['page-read', `page-malformed-${index}`] },
      [
        { id: 'page-read', permissions: ['MENU_ITEMS'], dataScope: 'SELF', allowedActions: ['READ'] },
        { id: `page-malformed-${index}`, permissions: ['MENU_ITEMS'], dataScope: 'SELF', allowedActions },
      ],
    );

    assert.equal(
      hasPageAction(merged, 'MENU_ITEMS', 'EXPORT'),
      false,
      `merged malformed allowedActions granted EXPORT: ${JSON.stringify(allowedActions)}`,
    );
  }

  const malformedOnly = getValidRoleForUser(
    { id: 'u-malformed-only', roleIds: ['page-object', 'page-scalar'] },
    [
      { id: 'page-object', permissions: ['MENU_ITEMS'], dataScope: 'SELF', allowedActions: { action: 'EXPORT' } },
      { id: 'page-scalar', permissions: ['MENU_ITEMS'], dataScope: 'SELF', allowedActions: 7 },
    ],
  );

  assert.equal(hasPageAction(malformedOnly, 'MENU_ITEMS', 'EXPORT'), false);
});

test('getValidRoleForUser fails closed on actual null actions for single and merged roles', () => {
  const nullRole = {
    id: 'page-null',
    permissions: ['MENU_ITEMS'],
    dataScope: 'SELF',
    allowedActions: null,
  };
  const readRole = {
    id: 'page-read',
    permissions: ['MENU_ITEMS'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
  };
  const single = getValidRoleForUser({ id: 'u-null-single', roleId: 'page-null' }, [nullRole]);
  const merged = getValidRoleForUser(
    { id: 'u-null-merged', roleIds: ['page-null', 'page-read'] },
    [nullRole, readRole],
  );

  assert.equal(hasPageAction(single, 'MENU_ITEMS', 'EXPORT'), false);
  assert.equal(hasPageAction(merged, 'MENU_ITEMS', 'EXPORT'), false);
});

test('getValidRoleForUser treats missing and empty action grants as no permission', () => {
  for (const [index, allowedActions] of [undefined, [], '[]'].entries()) {
    const openRole = {
      id: `page-open-${index}`,
      permissions: ['MENU_ITEMS'],
      dataScope: 'SELF',
      allowedActions,
    };
    const readRole = {
      id: `page-read-${index}`,
      permissions: ['MENU_ITEMS'],
      dataScope: 'SELF',
      allowedActions: ['READ'],
    };
    const single = getValidRoleForUser({ id: `u-open-single-${index}`, roleId: openRole.id }, [openRole]);
    const merged = getValidRoleForUser(
      { id: `u-open-merged-${index}`, roleIds: [openRole.id, readRole.id] },
      [openRole, readRole],
    );

    assert.equal(hasPageAction(single, 'MENU_ITEMS', 'EXPORT'), false);
    assert.equal(hasPageAction(merged, 'MENU_ITEMS', 'EXPORT'), false);
  }
});

test('hasAnyPermission only trusts role config permissions', () => {
  assert.equal(hasAnyPermission(null, ['MENU_ITEMS']), false);
  assert.equal(hasAnyPermission(roles[0], ['MENU_ITEMS']), true);
  assert.equal(hasAnyPermission(roles[0], ['MENU_ROLES']), false);
});

test('filterItemsByAccess returns only self scoped items', () => {
  const visible = filterItemsByAccess(
    [
      { id: 'i1', ownerId: '2', followerId: '3' },
      { id: 'i2', ownerId: '6', followerId: '3' },
      { id: 'i3', ownerId: '4', followerId: '6' },
    ],
    {
      currentUser: users[0],
      currentRole: roles[0],
      users,
    },
  );

  assert.deepEqual(visible.map((item) => item.id), ['i1', 'i2', 'i3']);
});

test('filterItemsByAccess supports multi-org owner and follower visibility', () => {
  const visible = filterItemsByAccess(
    [
      { id: 'i1', ownerId: '2', followerId: '4' },
      { id: 'i2', ownerId: '4', followerId: '3' },
      { id: 'i3', ownerId: '4', followerId: '4' },
    ],
    {
      currentUser: { ...users[0], roleId: 'r-multi-org' },
      currentRole: roles[1],
      users,
    },
  );

  assert.deepEqual(visible.map((item) => item.id), ['i1', 'i2']);
});

test('filterItemsByAccess uses user adminOrgIds for multi-org visibility', () => {
  const visible = filterItemsByAccess(
    [
      { id: 'i1', ownerId: '2', followerId: '4' },
      { id: 'i2', ownerId: '4', followerId: '3' },
      { id: 'i3', ownerId: '4', followerId: '4' },
    ],
    {
      currentUser: { ...users[0], roleId: 'r-multi-org', adminOrgIds: ['org-a'] },
      currentRole: { ...roles[1], orgIds: [] },
      users,
    },
  );

  assert.deepEqual(visible.map((item) => item.id), ['i1', 'i2']);
});

test('filterItemsByAccess limits owner org admin to items whose owners are in authorized orgs', () => {
  const visible = filterItemsByAccess(
    [
      { id: 'i1', ownerId: '2', followerId: '4' },
      { id: 'i2', ownerId: '4', followerId: '3' },
      { id: 'i3', ownerId: '4', followerId: '4' },
    ],
    {
      currentUser: { ...users[0], id: '8', roleId: 'r-multi-org-owner' },
      currentRole: roles[2],
      users,
    },
  );

  assert.deepEqual(visible.map((item) => item.id), ['i1']);
});

test('filterItemsByAccess limits follower org admin to items whose followers are in authorized orgs', () => {
  const visible = filterItemsByAccess(
    [
      { id: 'i1', ownerId: '2', followerId: '4' },
      { id: 'i2', ownerId: '4', followerId: '3' },
      { id: 'i3', ownerId: '4', followerId: '4' },
    ],
    {
      currentUser: { ...users[0], id: '8', roleId: 'r-multi-org-follower' },
      currentRole: roles[3],
      users,
    },
  );

  assert.deepEqual(visible.map((item) => item.id), ['i2']);
});

test('filterItemsByAccess supports self and all descendant subordinates owner scope', () => {
  const visible = filterItemsByAccess(
    [
      { id: 'i1', ownerId: '2', followerId: '4' },
      { id: 'i2', ownerId: '3', followerId: '4' },
      { id: 'i3', ownerId: '4', followerId: '2' },
      { id: 'i4', ownerId: '4', followerId: '4' },
      { id: 'i5', ownerId: '8', followerId: '4' },
    ],
    {
      currentUser: users[0],
      currentRole: roles[4],
      users,
    },
  );

  assert.deepEqual(visible.map((item) => item.id), ['i1', 'i2', 'i3', 'i5']);
});

test('filterItemsByAccess includes current department users and reporting subordinates for department managers', () => {
  const visible = filterItemsByAccess(
    [
      { id: 'i1', ownerId: '2', followerId: '4' },
      { id: 'i2', ownerId: '4', followerId: '3' },
      { id: 'i3', ownerId: '4', followerId: '4' },
      { id: 'i4', ownerId: '8', followerId: '4' },
    ],
    {
      currentUser: { ...users[0], roleId: 'r-dept' },
      currentRole: roles[5],
      users,
    },
  );

  assert.deepEqual(visible.map((item) => item.id), ['i1', 'i2', 'i4']);
});

test('filterItemsByAccess includes child department users for department managers', () => {
  const visible = filterItemsByAccess(
    [
      { id: 'i-parent-dept', ownerId: '2', followerId: '4' },
      { id: 'i-child-dept', ownerId: '9', followerId: '4' },
      { id: 'i-other-dept', ownerId: '4', followerId: '4' },
    ],
    {
      currentUser: { ...users[0], roleId: 'r-dept' },
      currentRole: roles[5],
      users: [
        ...users,
        { id: '9', role: '责任人', roleId: 'r-self', orgId: 'org-b', deptId: 'dept-1-child', supervisorId: null, status: 'ACTIVE' },
      ],
      departments: [
        { id: 'dept-1', parentId: null },
        { id: 'dept-1-child', parentId: 'dept-1' },
        { id: 'dept-2', parentId: null },
      ],
    },
  );

  assert.deepEqual(visible.map((item) => item.id), ['i-parent-dept', 'i-child-dept']);
});

test('filterItemsByAccess includes cross-department reporting subordinates for department managers', () => {
  const visible = filterItemsByAccess(
    [
      { id: 'i-reporting-owner', ownerId: '9', followerId: '4' },
      { id: 'i-reporting-follower', ownerId: '4', followerId: '9' },
      { id: 'i-unrelated', ownerId: '4', followerId: '4' },
    ],
    {
      currentUser: { ...users[0], roleId: 'r-dept' },
      currentRole: roles[5],
      users: [
        ...users,
        { id: '9', role: '责任人', roleId: 'r-self', orgId: 'org-c', deptId: 'dept-other', supervisorId: '6', status: 'ACTIVE' },
      ],
      departments: [
        { id: 'dept-1', parentId: null },
        { id: 'dept-other', parentId: null },
      ],
    },
  );

  assert.deepEqual(visible.map((item) => item.id), ['i-reporting-owner', 'i-reporting-follower']);
});

test('filterItemsByAccess uses split owner custom users for department owner scope', () => {
  const visible = filterItemsByAccess(
    [
      { id: 'i1', ownerId: '4', followerId: '2' },
      { id: 'i2', ownerId: '4', followerId: '4' },
      { id: 'i3', ownerId: '2', followerId: '4' },
    ],
    {
      currentUser: { ...users[0], roleId: 'r-dept-owner' },
      currentRole: roles[6],
      users,
    },
  );

  assert.deepEqual(visible.map((item) => item.id), ['i1', 'i2', 'i3']);
});

test('filterItemsByAccess uses split follower custom users for department follower scope', () => {
  const visible = filterItemsByAccess(
    [
      { id: 'i1', ownerId: '4', followerId: '4' },
      { id: 'i2', ownerId: '4', followerId: '2' },
      { id: 'i3', ownerId: '2', followerId: '4' },
    ],
    {
      currentUser: { ...users[0], roleId: 'r-dept-follower' },
      currentRole: roles[7],
      users,
    },
  );

  assert.deepEqual(visible.map((item) => item.id), ['i1', 'i2', 'i3']);
});

test('filterItemsByAccess allows shared users to view shared items read-only', () => {
  const visible = filterItemsByAccess(
    [
      { id: 'i1', ownerId: '2', followerId: '4' },
      { id: 'i2', ownerId: '4', followerId: '4', sharedWith: [{ userId: '6', userName: '共享接收人' }] },
    ],
    {
      currentUser: users[0],
      currentRole: roles[0],
      users,
    },
  );

  assert.deepEqual(visible.map((item) => item.id), ['i2']);
});

test('filterItemsByAccess hides soft-deleted items by default and exposes them only to an explicit recycle-bin context', () => {
  const items = [
    { id: 'active', ownerId: '6', followerId: '2', deletedAt: null },
    { id: 'deleted', ownerId: '6', followerId: '2', deletedAt: new Date('2026-08-14T00:00:00.000Z') },
  ];
  const input = {
    currentUser: users[0],
    currentRole: { ...roles[0], dataScope: 'ALL' },
    users,
  };

  assert.deepEqual(filterItemsByAccess(items, input).map((item) => item.id), ['active']);
  assert.deepEqual(filterItemsByAccess(items, input, { includeDeleted: true }).map((item) => item.id), ['active', 'deleted']);
  assert.deepEqual(filterItemsByAccess(items, input, { includeDeleted: true, onlyDeleted: true }).map((item) => item.id), ['deleted']);
});

test('filterUsersByAccess limits org admin directory data to the authorized org set', () => {
  const visible = filterUsersByAccess(
    users,
    {
      currentUser: { ...users[0], roleId: 'r-multi-org', adminOrgIds: ['org-a'] },
      currentRole: { ...roles[1], orgIds: [] },
      users,
    },
  );

  assert.deepEqual(visible.map((user) => user.id), ['2', '3']);
});
