import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveWorkbenchMetricMode, getWorkbenchCardDrill } from './MetricCards';
import { buildWorkbenchStatusMetrics, isUserWorkbenchItem, isWorkbenchPendingOpenItem, isWorkbenchNoFeedbackItem, isWorkbenchIncompleteItem } from './workbench-metrics';
import { isItemOwnerForUser, isItemFollowerForUser, isItemRelatedToUser, getEffectiveItemStatus } from '../../../lib/item-format';
import { mapRoleIdentityToUserRole } from '../../../store/role-access';
import { SupervisionItem, User, Role, SubTask } from '../../../types';

function subTask(name: string, status: string, assigneeId: string): SubTask {
  return {
    id: 'st-' + name, title: '子-' + name, deadline: '2026-08-31', status: status as SubTask['status'],
    assigneeId, assigneeName: name, progress: 0,
  } as SubTask;
}

const baseItem = {
  id: 'x', serialNo: 'DB-X', title: 't', content: 'c', status: 'PENDING', deadline: '2026-08-31',
  ownerId: 'o', ownerName: '负责人', followerId: 'f', followerName: '跟进', progress: 0,
  category: '测试', campus: '总部', timeline: [],
};
function item(o: Partial<SupervisionItem>): SupervisionItem {
  return { ...baseItem, ...o, id: o.id as string, serialNo: o.serialNo || `DB-${o.id}`, timeline: o.timeline || [] } as SupervisionItem;
}

const WEIHY_ID = 'dfe5376f-ea14-48f9-b127-356dff3c575f';

const r6: Role = {
  id: 'r6', name: '督办责任人', description: '', permissions: [], dataScope: 'SELF', followerDataScope: undefined,
  authCodes: [],
  allowedActions: [], allowedPageActions: {}, orgIds: [], customUserIds: [], ownerCustomUserIds: [], followerCustomUserIds: [],
} as unknown as Role;
const r1: Role = {
  id: 'r1', name: '管理员', description: '', permissions: [], dataScope: 'ALL', followerDataScope: undefined,
  authCodes: [],
  allowedActions: [], allowedPageActions: {}, orgIds: [], customUserIds: [], ownerCustomUserIds: [], followerCustomUserIds: [],
} as unknown as Role;

// 组织架构记录（来自 org API，携带正确 roleId）—— 这是 resolveWorkbenchMetricMode 实际接收的对象
const weihyOrgUser: User = { id: WEIHY_ID, name: '魏红义', username: '00000107', roleId: 'r6', roleIds: ['r6'] } as User;
// localStorage 旧登录对象（缺 roleId/roleIds）—— 直接用它判定会误判
const weihyStaleLogin: User = { id: WEIHY_ID, name: '魏红义', username: '00000107' } as User;
const adminUser: User = { id: 'admin1', name: '张管理', username: 'admin', roleId: 'r1', roleIds: ['r1'] } as User;

// A: 魏红义未签（应计入待签收）  B/C/D: 魏红义已签（不计入待签收，但计入未完成）
function mixedItems(): SupervisionItem[] {
  return [
    item({ id: 'A', status: 'EXECUTING', ownerName: '张三', ownerIds: ['zhang', WEIHY_ID], subTasks: [subTask('张三', 'PENDING', 'zhang'), subTask('魏红义', 'PENDING', WEIHY_ID)] }),
    item({ id: 'B', status: 'EXECUTING', ownerName: '李四', ownerIds: ['li', WEIHY_ID], subTasks: [subTask('李四', 'PENDING', 'li'), subTask('魏红义', 'EXECUTING', WEIHY_ID)], timeline: [{ id: 'sb', type: 'SIGN', user: '魏红义', content: '签收', timestamp: '2026-07-01 09:00' }] }),
    item({ id: 'C', status: 'EXECUTING', ownerName: '王五', ownerIds: ['wang', WEIHY_ID], subTasks: [subTask('王五', 'PENDING', 'wang'), subTask('魏红义', 'EXECUTING', WEIHY_ID)], timeline: [{ id: 'sc', type: 'SIGN', user: '魏红义', content: '签收', timestamp: '2026-07-02 09:00' }] }),
    item({ id: 'D', status: 'EXECUTING', ownerName: '赵六', ownerIds: ['zhao', WEIHY_ID], subTasks: [subTask('赵六', 'PENDING', 'zhao'), subTask('魏红义', 'EXECUTING', WEIHY_ID)], timeline: [{ id: 'sd', type: 'SIGN', user: '魏红义', content: '签收', timestamp: '2026-07-03 09:00' }] }),
  ];
}

test('纯责任人(组织架构记录带 roleId r6) → person 模式（正常登录）', () => {
  assert.equal(resolveWorkbenchMetricMode(weihyOrgUser, [r6, r1]), 'person');
});

test('管理员(roleId r1, ALL) → item 模式（回归，不被误判为责任人）', () => {
  assert.equal(resolveWorkbenchMetricMode(adminUser, [r6, r1]), 'item');
});

test('缺少角色记录 → item 模式（保守，不臆测为责任人）', () => {
  // 旧登录对象缺 roleId，直接用它判定应落到 item（不会误显示待签收=本人未签）
  assert.equal(resolveWorkbenchMetricMode(weihyStaleLogin, [r6, r1]), 'item');
});

test('实际修复路径：MetricCards 用 orgUsers 记录解析 → person（旧登录对象缺 roleId 也能正确）', () => {
  // 模拟 MetricCards 内部：effectiveUser = orgUsers.find(id) || currentUser
  const orgUsers: User[] = [weihyOrgUser];
  const effectiveUser = orgUsers.find(u => u.id === weihyStaleLogin.id) || weihyStaleLogin;
  assert.equal(resolveWorkbenchMetricMode(effectiveUser, [r6, r1]), 'person');
});

test('person 模式：待签收只计本人未签=1，下钻列表只含 A', () => {
  const items = mixedItems();
  const scoped = items.filter(i => isItemOwnerForUser(i, weihyOrgUser));
  const m = buildWorkbenchStatusMetrics(scoped, 'person', weihyOrgUser);
  const pending = m.find(x => x.key === 'pendingOpen')!;
  assert.equal(pending.value, 1, '待签收只计本人未签的子任务（多责任人本人已签他人未签不计入）');
  const drill = items.filter(i => isUserWorkbenchItem('pendingOpen', i, weihyOrgUser)).map(i => i.id);
  assert.deepEqual(drill, ['A'], '下钻列表只含本人未签的事项 A');
});

test('person 模式：未完成计本人非 COMPLETED 的子任务(A、B、C、D)=4，已完成=0', () => {
  const items = mixedItems();
  const scoped = items.filter(i => isItemOwnerForUser(i, weihyOrgUser));
  const m = buildWorkbenchStatusMetrics(scoped, 'person', weihyOrgUser);
  assert.equal(m.find(x => x.key === 'incomplete')!.value, 4, 'A、B、C、D 的魏红义子任务均未完成');
  assert.equal(m.find(x => x.key === 'completed')!.value, 0);
});

// 跟进人(r2)数据范围为部门级(DEPT)：可见范围内包含大量他人负责的督办，
// 但首页卡片应只统计「本人作为责任人和/或跟进人」的事项，避免「首页有数、我的待办为空」。
const r2: Role = {
  id: 'r2', name: '督办跟进人', description: '', permissions: [], dataScope: 'DEPT', followerDataScope: 'DEPT',
  authCodes: [], allowedActions: [], allowedPageActions: {}, orgIds: [], customUserIds: [], ownerCustomUserIds: [], followerCustomUserIds: [],
} as unknown as Role;
const followerUser: User = { id: 'f1', name: '跟进人甲', username: 'f001', roleId: 'r2', roleIds: ['r2'] } as User;

test('跟进人(r2, DEPT) → item 模式（数据范围非 SELF）', () => {
  assert.equal(resolveWorkbenchMetricMode(followerUser, [r2]), 'item');
  assert.equal(mapRoleIdentityToUserRole(followerUser), 'FOLLOWER');
});

test('跟进人首页指标只统计本人责任/跟进事项（与《我的督办》一致）', () => {
  const deptItems: SupervisionItem[] = [
    item({ id: 'itemX', ownerId: 'o1', ownerName: '负责人1', followerId: 'o2', followerName: '别人' }),
    item({ id: 'itemY', ownerId: 'o1', ownerName: '负责人1', followerId: 'f1', followerName: '跟进人甲' }),
    item({ id: 'itemZ', ownerId: 'o3', ownerName: '负责人3', followerId: 'o4', followerName: '别人2' }),
  ];
  // 收窄后只含本人跟进的 itemY（与 buildMyItemsScope 的 followedItems/ownedItems 口径一致）
  const scoped = deptItems.filter(i => isItemOwnerForUser(i, followerUser) || isItemFollowerForUser(i, followerUser));
  assert.deepEqual(scoped.map(i => i.id), ['itemY'], '仅本人相关事项进入首页统计，别人负责的 itemX/itemZ 不计入');
  const m = buildWorkbenchStatusMetrics(scoped, 'item');
  assert.equal(m.find(x => x.key === 'incomplete')!.value, 1, '未完成只计本人跟进的 itemY');
});

// 下钻目标必须是「事项列表页」(/items)，而非《我的督办》。此前跟进人卡片错误地跳到
// /my-items（我的待办任务列表），既偏离事项列表语义，又无法覆盖已超期/未完成等卡片口径。
test('getWorkbenchCardDrill: 跟进人 → /items 且带 scope=mine', () => {
  const baseParams = '?pendingOpen=1';
  const drill = getWorkbenchCardDrill({ metricMode: 'item', isFollower: true, basePath: '/items', baseParams });
  assert.equal(drill.path, '/items', '跟进人下钻进入事项列表页');
  assert.equal(drill.params, '?pendingOpen=1&scope=mine', '跟进人下钻收窄到本人责任/跟进事项');
});

test('getWorkbenchCardDrill: 纯责任人 → /items 且带 ownerId=me', () => {
  const drill = getWorkbenchCardDrill({ metricMode: 'person', isFollower: false, basePath: '/items', baseParams: '?status=COMPLETED' });
  assert.equal(drill.path, '/items');
  assert.equal(drill.params, '?status=COMPLETED&ownerId=me');
});

test('getWorkbenchCardDrill: 管理员/领导(item) → /items 且不加额外收窄', () => {
  const drill = getWorkbenchCardDrill({ metricMode: 'item', isFollower: false, basePath: '/items', baseParams: '?status=OVERDUE,DELAYED' });
  assert.equal(drill.path, '/items');
  assert.equal(drill.params, '?status=OVERDUE,DELAYED');
});

// 宽范围跟进人（如吴艺悦 r2+r5 组织管理员 MULTI_ORG）：可见范围内含大量同组织、非本人相关的事项。
// 修复前：下钻跳到 /my-items 且口径不符；若直接跳 /items 而不收窄，completed 等卡片会多算组织内他人事项。
// 修复后：scope=mine 把 /items 收窄到「本人责任/跟进」事项，下钻条数与首页卡片一一对应。
test('宽范围跟进人(吴艺悦 r2+r5): 首页卡片条数 === /items?scope=mine 下钻条数', () => {
  const follower = { id: 'f-wide', name: '吴艺悦', username: '00000210', roleId: 'r2', roleIds: ['r2', 'r5'] } as User;
  // visibleItems = 跟进人可见范围（含本人相关 + 同组织他人负责的大批事项）。
  // 注意：status 用真实值，getEffectiveItemStatus 由 status/timeline 推导，不读假设的 effectiveStatus 字段。
  const visibleItems: SupervisionItem[] = [
    item({ id: 'mine-own-overdue', status: 'OVERDUE', ownerId: 'f-wide', ownerName: '吴艺悦' }),
    item({ id: 'mine-follow-completed', status: 'COMPLETED', followerId: 'f-wide', followerName: '吴艺悦' }),
    item({ id: 'mine-follow-exec', status: 'EXECUTING', followerId: 'f-wide', followerName: '吴艺悦' }),
    // 同组织、非本人相关：不应进入首页卡片，也不应进入 scope=mine 下钻
    item({ id: 'org-other-pending', status: 'PENDING', ownerId: 'o-x', ownerName: '别人', followerId: 'o-y', followerName: '别人2' }),
    item({ id: 'org-other-overdue', status: 'OVERDUE', ownerId: 'o-x', ownerName: '别人' }),
    item({ id: 'org-other-completed', status: 'COMPLETED', ownerId: 'o-x', ownerName: '别人' }),
  ];

  // 首页卡片口径：scopedItems = 本人相关事项
  const scoped = visibleItems.filter(i => isItemRelatedToUser(i, follower));
  assert.deepEqual(scoped.map(i => i.id), ['mine-own-overdue', 'mine-follow-completed', 'mine-follow-exec']);
  const card = buildWorkbenchStatusMetrics(scoped, 'item');

  // /items?scope=mine 下钻：在 visibleItems 基础上再按 related 收窄（与 Items/index.tsx 内联逻辑一致），
  // 再按卡片语义状态谓词过滤。
  const drillBase = visibleItems.filter(i => isItemRelatedToUser(i, follower)); // === scoped
  const drillCounts = {
    pendingOpen: drillBase.filter(isWorkbenchPendingOpenItem).length,
    overdue: drillBase.filter(i => getEffectiveItemStatus(i) === 'OVERDUE' || getEffectiveItemStatus(i) === 'DELAYED').length,
    noFeedback: drillBase.filter(isWorkbenchNoFeedbackItem).length,
    incomplete: drillBase.filter(isWorkbenchIncompleteItem).length,
    completed: drillBase.filter(i => getEffectiveItemStatus(i) === 'COMPLETED').length,
  };

  assert.equal(drillCounts.pendingOpen, card.find(c => c.key === 'pendingOpen')!.value);
  assert.equal(drillCounts.overdue, card.find(c => c.key === 'overdue')!.value);
  assert.equal(drillCounts.noFeedback, card.find(c => c.key === 'noFeedback')!.value);
  assert.equal(drillCounts.incomplete, card.find(c => c.key === 'incomplete')!.value);
  assert.equal(drillCounts.completed, card.find(c => c.key === 'completed')!.value);

  // 关键回归：若没有 scope=mine（直接展示 visibleItems），completed 会多算 org-other-completed → 2 而非 1。
  const withoutScope = visibleItems.filter(i => getEffectiveItemStatus(i) === 'COMPLETED').length;
  assert.notEqual(withoutScope, drillCounts.completed, '无 scope=mine 时宽范围跟进人下钻条数会多于卡片（旧 bug 根因）');
});
