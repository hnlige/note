import test from 'node:test';
import assert from 'node:assert/strict';

import type { DeptNode, OrgUser, Role, SubTask, SupervisionItem, User } from '../types';
import { buildMobileHomeTabs, filterItemsByMobileTab } from './mobile-home-metrics';

const roles: Role[] = [
  { id: 'r1', name: '超级管理员', authCodes: ['ALL'], dataScope: 'ALL', followerDataScope: 'ALL' },
  { id: 'r2', name: '督办跟进人', authCodes: [], dataScope: 'SELF', followerDataScope: 'SELF' },
  { id: 'r3', name: '部门管理员', authCodes: [], dataScope: 'DEPT', followerDataScope: 'DEPT' },
  { id: 'r6', name: '责任人', authCodes: [], dataScope: 'SELF' },
];

const departments: DeptNode[] = [{ id: 'd1', name: '总务处', parentId: '' }];

const ownerUser = { id: 'u-zhang', name: '张三', username: 'zhangsan' } as User;
const otherUser = { id: 'u-li', name: '李四', username: 'lisi' } as User;

function orgUser(user: Pick<User, 'id' | 'name' | 'username'>, roleId: string): OrgUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username || '',
    role: '',
    roleId,
    roleIds: [roleId],
    email: '',
    phone: '',
    status: 'ACTIVE',
    deptId: 'd1',
  };
}

function subTask(name: string, status: SubTask['status'], extra: Partial<SubTask> = {}): SubTask {
  return {
    id: `sub-${name}`,
    title: `子任务-${name}`,
    deadline: '2026-08-31',
    status,
    assigneeId: `id-${name}`,
    assigneeName: name,
    progress: 0,
    ...extra,
  };
}

const baseItem: SupervisionItem = {
  id: 'item-base',
  serialNo: 'DB-BASE',
  title: '测试事项',
  content: '测试内容',
  status: 'PENDING',
  deadline: '2026-08-31',
  ownerId: 'u-zhang',
  ownerName: '张三',
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
    id: overrides.id || baseItem.id,
    serialNo: overrides.serialNo || `DB-${overrides.id || 'BASE'}`,
  };
}

function input(
  user: User,
  items: SupervisionItem[],
): Parameters<typeof buildMobileHomeTabs>[0] {
  const role = roles.find(r => r.name === (user === otherUser ? '督办跟进人' : '责任人'))!;
  return { items, currentUser: user, orgUsers: [orgUser(ownerUser, role.id)], roles, departments };
}

test('五个顶部标签的标题与顺序对所有角色完全一致', () => {
  const expectedTitles = ['待签收', '已超期', '未反馈', '未完成', '已完成'];
  for (const roleId of ['r1', 'r2', 'r3', 'r6']) {
    const tabs = buildMobileHomeTabs({
      items: [],
      currentUser: ownerUser,
      orgUsers: [orgUser(ownerUser, roleId)],
      roles,
      departments,
    });
    assert.deepEqual(tabs.map(tab => tab.title), expectedTitles, `角色 ${roleId} 标签集合应一致`);
    assert.deepEqual(tabs.map(tab => tab.value), [0, 0, 0, 0, 0]);
  }
});

test('纯责任人 person 口径：本人子任务统计且同事项去重，下钻条数与计数一致', () => {
  const items = [
    // 张三在同一事项上有两个未签收子任务：待签收/未完成均只按事项计 1
    item({
      id: 'own-multi',
      status: 'EXECUTING',
      effectiveStatus: 'EXECUTING',
      subTasks: [
        subTask('张三', 'PENDING', { signed: false }),
        subTask('张三-2', 'PENDING', { signed: false, assigneeId: 'u-zhang', assigneeName: '张三' }),
      ],
    }),
    // 本人已签收、未反馈
    item({
      id: 'own-no-feedback',
      status: 'EXECUTING',
      effectiveStatus: 'EXECUTING',
      subTasks: [subTask('张三', 'EXECUTING', { signed: true })],
    }),
    // 本人子任务已完成
    item({
      id: 'own-completed',
      status: 'COMPLETED',
      effectiveStatus: 'COMPLETED',
      subTasks: [subTask('张三', 'COMPLETED', { signed: true, feedbackGiven: true })],
    }),
    // 李四的事项对张三（SELF 范围）不可见
    item({
      id: 'other-owner',
      ownerId: 'u-li',
      ownerName: '李四',
      subTasks: [subTask('李四', 'PENDING', { signed: false })],
    }),
  ];

  const tabs = buildMobileHomeTabs(input(ownerUser, items));
  assert.deepEqual(
    tabs.map(tab => [tab.title, tab.value]),
    [['待签收', 1], ['已超期', 0], ['未反馈', 1], ['未完成', 2], ['已完成', 1]],
  );

  for (const tab of buildMobileHomeTabs(input(ownerUser, items))) {
    assert.equal(
      filterItemsByMobileTab(tab.key, input(ownerUser, items)).length,
      tab.value,
      `${tab.title} 下钻条数应与首页标签一致`,
    );
  }
});

test('超级管理员 item 口径：按可见范围事项级统计，未反馈看签收+反馈标记', () => {
  const adminInput = {
    items: [
      item({ id: 'unsigned', status: 'EXECUTING', effectiveStatus: 'EXECUTING', signOffStatus: 'NOT_SIGNED' }),
      item({ id: 'no-feedback', status: 'EXECUTING', effectiveStatus: 'EXECUTING', signOffStatus: 'SIGNED', hasFeedback: false }),
      item({ id: 'feedbacked', status: 'EXECUTING', effectiveStatus: 'EXECUTING', signOffStatus: 'SIGNED', hasFeedback: true }),
      item({ id: 'completed', status: 'COMPLETED', effectiveStatus: 'COMPLETED', signOffStatus: 'SIGNED', hasFeedback: true }),
    ],
    currentUser: ownerUser,
    orgUsers: [orgUser(ownerUser, 'r1')],
    roles,
    departments,
  };

  assert.deepEqual(
    buildMobileHomeTabs(adminInput).map(tab => [tab.title, tab.value]),
    [['待签收', 1], ['已超期', 0], ['未反馈', 1], ['未完成', 3], ['已完成', 1]],
  );

  for (const tab of buildMobileHomeTabs(adminInput)) {
    assert.equal(filterItemsByMobileTab(tab.key, adminInput).length, tab.value, `${tab.title} 下钻一致`);
  }
});

test('督办跟进人：只统计本人跟进/负责事项，口径为事项级', () => {
  const followerInput = {
    items: [
      item({
        id: 'followed-overdue',
        ownerId: 'someone-else',
        ownerName: '王五',
        followerIds: ['u-zhang'],
        status: 'OVERDUE',
        effectiveStatus: 'OVERDUE',
        signOffStatus: 'SIGNED',
        hasFeedback: false,
      }),
      item({ id: 'not-related', ownerId: 'someone-else', ownerName: '王五' }),
    ],
    currentUser: ownerUser,
    orgUsers: [orgUser(ownerUser, 'r2')],
    roles,
    departments,
  };

  assert.deepEqual(
    buildMobileHomeTabs(followerInput).map(tab => [tab.title, tab.value]),
    [['待签收', 0], ['已超期', 1], ['未反馈', 1], ['未完成', 1], ['已完成', 0]],
  );
});

test('部门管理员 item 口径：可见范围内全量统计而非仅本人名下', () => {
  const deptAdminInput = {
    items: [
      item({ id: 'dept-item-1', status: 'PENDING', effectiveStatus: 'PENDING', signOffStatus: 'NOT_SIGNED' }),
      item({ id: 'dept-item-2', status: 'DELAYED', effectiveStatus: 'DELAYED', signOffStatus: 'PARTIAL' }),
    ],
    currentUser: ownerUser,
    orgUsers: [orgUser(ownerUser, 'r3')],
    roles,
    departments,
  };

  const tabs = buildMobileHomeTabs(deptAdminInput);
  assert.deepEqual(
    tabs.map(tab => [tab.title, tab.value]),
    // PARTIAL（部分签收）同样计入待签收，与事项级口径一致
    [['待签收', 2], ['已超期', 1], ['未反馈', 0], ['未完成', 2], ['已完成', 0]],
  );
  // 未反馈=0：两张卡均为已超期/待签收场景，无「已签收且未反馈」事项
  assert.equal(filterItemsByMobileTab('incomplete', deptAdminInput).length, 2);
});
