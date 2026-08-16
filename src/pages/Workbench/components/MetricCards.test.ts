import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveWorkbenchMetricMode } from './MetricCards';
import { buildWorkbenchStatusMetrics, isUserWorkbenchItem } from './workbench-metrics';
import { isItemOwnerForUser } from '../../../lib/item-format';
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
