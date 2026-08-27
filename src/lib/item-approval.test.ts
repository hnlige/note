import test from 'node:test';
import assert from 'node:assert/strict';
import { getItemApprovalState } from './item-approval.ts';
import type { OrgUser, SupervisionItem, User } from '../types';

const item: SupervisionItem = {
  id: 'item-1', serialNo: 'ITEM-1', title: '测试事项', content: '', status: 'REVIEWING', deadline: '',
  ownerId: 'owner-1', ownerName: '责任人', followerId: 'follower-1', followerName: '吴丽珠', progress: 100,
  category: '', campus: '', timeline: [],
  subTasks: [{ id: 'task-1', parentItemId: 'item-1', title: '责任人任务', deadline: '', status: 'REVIEWING', assigneeId: 'owner-1', assigneeName: '责任人', followerApprovedBy: '', finalApprovedBy: '' }],
};

const follower: User = { id: 'follower-1', name: '吴丽珠', username: 'wlz', role: 'FOLLOWER' };
const supervisor: User = { id: 'leader-1', name: '直属上级', username: 'leader', role: 'FOLLOWER' };
const orgUsers: OrgUser[] = [
  { id: 'follower-1', name: '吴丽珠', username: 'wlz', role: 'FOLLOWER', email: '', phone: '', status: 'ACTIVE', deptId: 'd1', supervisorId: 'leader-1' },
  { id: 'leader-1', name: '直属上级', username: 'leader', role: 'FOLLOWER', email: '', phone: '', status: 'ACTIVE', deptId: 'd1' },
];

test('跟进人看到本级审批，且本级审批后等待上级', () => {
  const pending = getItemApprovalState(item, follower, orgUsers);
  assert.equal(pending.pendingFollowerApproval, true);
  assert.equal(pending.showApprovePanel, true);

  const submitted = getItemApprovalState({ ...item, subTasks: [{ ...item.subTasks![0], followerApprovedBy: '吴丽珠' }] }, follower, orgUsers);
  assert.equal(submitted.submittedToLeader, true);
  assert.equal(submitted.showApprovePanel, false);
});

test('跟进人的直属上级看到终审入口', () => {
  const state = getItemApprovalState({ ...item, subTasks: [{ ...item.subTasks![0], followerApprovedBy: '吴丽珠' }] }, supervisor, orgUsers);
  assert.equal(state.isFinalApprover, true);
  assert.equal(state.pendingFinalApproval, true);
  assert.equal(state.showApprovePanel, true);
});

test('无关用户和已终审子任务不能审批', () => {
  const outsider: User = { id: 'outsider', name: '无关用户', username: 'out', role: 'OWNER' };
  assert.equal(getItemApprovalState(item, outsider, orgUsers).showApprovePanel, false);
  assert.equal(getItemApprovalState({ ...item, subTasks: [{ ...item.subTasks![0], followerApprovedBy: '吴丽珠', finalApprovedBy: '直属上级', status: 'COMPLETED' }] }, supervisor, orgUsers).showApprovePanel, false);
});
