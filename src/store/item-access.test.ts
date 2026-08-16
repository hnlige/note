import test from 'node:test';
import assert from 'node:assert/strict';

import { filterVisibleItems, isSelfOnlyOwnerRole } from './item-access.ts';
import { DeptNode, OrgUser, Role, SupervisionItem } from '../types';

const roles: Role[] = [
  {
    id: 'org-admin',
    name: '组织管理员',
    authCodes: ['MENU_ITEMS'],
    dataScope: 'MULTI_ORG',
    followerDataScope: 'MULTI_ORG',
    orgIds: ['org-role'],
  },
  {
    id: 'dept-admin',
    name: '部门管理员',
    authCodes: ['MENU_ITEMS'],
    dataScope: 'DEPT',
    followerDataScope: 'DEPT',
  },
];

const departments: DeptNode[] = [
  {
    id: 'dept-parent',
    name: '父部门',
    children: [
      { id: 'dept-child', name: '子部门' },
    ],
  },
  { id: 'dept-other', name: '其他部门' },
];

const orgUsers: OrgUser[] = [
  {
    id: 'org-admin-user',
    name: '组织管理员',
    username: 'org-admin',
    role: '组织管理员',
    roleId: 'org-admin',
    email: '',
    phone: '',
    status: 'ACTIVE',
    deptId: 'dept-other',
    orgId: 'org-other',
    adminOrgIds: ['org-user'],
  },
  {
    id: 'dept-admin-user',
    name: '部门管理员',
    username: 'dept-admin',
    role: '部门管理员',
    roleId: 'dept-admin',
    email: '',
    phone: '',
    status: 'ACTIVE',
    deptId: 'dept-parent',
    orgId: 'org-user',
  },
  {
    id: 'role-org-owner',
    name: '角色组织责任人',
    username: 'role-org-owner',
    role: '责任人',
    email: '',
    phone: '',
    status: 'ACTIVE',
    deptId: 'dept-other',
    orgId: 'org-role',
  },
  {
    id: 'user-org-owner',
    name: '用户组织责任人',
    username: 'user-org-owner',
    role: '责任人',
    email: '',
    phone: '',
    status: 'ACTIVE',
    deptId: 'dept-other',
    orgId: 'org-user',
  },
  {
    id: 'child-owner',
    name: '子部门责任人',
    username: 'child-owner',
    role: '责任人',
    email: '',
    phone: '',
    status: 'ACTIVE',
    deptId: 'dept-child',
    orgId: 'org-user',
  },
  {
    id: 'other-owner',
    name: '其他责任人',
    username: 'other-owner',
    role: '责任人',
    email: '',
    phone: '',
    status: 'ACTIVE',
    deptId: 'dept-other',
    orgId: 'org-other',
  },
];

function item(id: string, ownerId: string, followerId = 'other-owner'): SupervisionItem {
  return {
    id,
    serialNo: id,
    title: id,
    content: id,
    status: 'EXECUTING',
    deadline: '2026-08-31',
    ownerId,
    ownerName: ownerId,
    followerId,
    followerName: followerId,
    progress: 0,
    category: '测试',
    campus: '测试',
    timeline: [],
  };
}

test('filterVisibleItems uses user adminOrgIds before role orgIds for organization managers', () => {
  const visible = filterVisibleItems({
    items: [
      item('role-org-item', 'role-org-owner'),
      item('user-org-item', 'user-org-owner'),
      item('other-org-item', 'other-owner'),
    ],
    currentUser: orgUsers[0],
    orgUsers,
    roles,
    departments,
  });

  assert.deepEqual(visible.map(row => row.id), ['user-org-item']);
});

test('filterVisibleItems includes current department and child departments for department managers', () => {
  const visible = filterVisibleItems({
    items: [
      item('parent-dept-item', 'dept-admin-user'),
      item('child-dept-item', 'child-owner'),
      item('other-dept-item', 'other-owner'),
    ],
    currentUser: orgUsers[1],
    orgUsers,
    roles,
    departments,
  });

  assert.deepEqual(visible.map(row => row.id), ['parent-dept-item', 'child-dept-item']);
});

test('isSelfOnlyOwnerRole is false for organization/department managers (overview, not self-only)', () => {
  assert.equal(isSelfOnlyOwnerRole(orgUsers[0], roles), false, '组织管理员(MULTI_ORG) 看组织全量');
  assert.equal(isSelfOnlyOwnerRole(orgUsers[1], roles), false, '部门管理员(DEPT) 看部门全量');
});

test('isSelfOnlyOwnerRole is true only for a pure owner (dataScope SELF, no follower scope)', () => {
  const pureOwner: OrgUser = {
    id: 'pure-owner',
    name: '纯责任人',
    username: 'pure-owner',
    role: '责任人',
    roleId: 'owner-role',
    email: '',
    phone: '',
    status: 'ACTIVE',
    deptId: 'dept-other',
    orgId: 'org-other',
  };
  const ownerRole: Role[] = [
    { id: 'owner-role', name: '责任人', authCodes: [], dataScope: 'SELF' },
  ];
  assert.equal(isSelfOnlyOwnerRole(pureOwner, ownerRole), true);

  // 跟进人：dataScope SELF 但 followerDataScope 非 null → 看跟进范围概览，不应仅自己名下
  const followerRole: Role[] = [
    { id: 'follower-role', name: '督办跟进人', authCodes: [], dataScope: 'SELF', followerDataScope: 'SELF' },
  ];
  assert.equal(isSelfOnlyOwnerRole(pureOwner, followerRole), false);
});
