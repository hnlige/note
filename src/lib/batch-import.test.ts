import test from 'node:test';
import assert from 'node:assert/strict';

import { rowToCreatePayload } from './batch-import.ts';
import { DeptNode, OrgUser } from '../types';

const departments: DeptNode[] = [
  { id: 'dept-1', name: '院长办公室' },
  { id: 'dept-2', name: '科研处' },
];

const orgUsers: OrgUser[] = [
  {
    id: 'u-owner-1',
    name: '李承办',
    username: 'E001',
    role: '责任人',
    roleId: 'r6',
    email: '',
    phone: '',
    status: 'ACTIVE',
    deptId: 'dept-1',
  },
  {
    id: 'u-owner-2',
    name: '丁敏',
    username: 'E002',
    role: '责任人',
    roleId: 'r6',
    email: '',
    phone: '',
    status: 'ACTIVE',
    deptId: 'dept-2',
  },
  {
    id: 'u-follower',
    name: '王跟进',
    username: 'F001',
    role: '督办专员',
    roleId: 'r2',
    email: '',
    phone: '',
    status: 'ACTIVE',
    deptId: 'dept-1',
  },
];

test('rowToCreatePayload resolves owner employee numbers and backfills owner departments', () => {
  const payload = rowToCreatePayload({
    rowIndex: 2,
    serialNo: 'DB-2026-001',
    title: '测试督办',
    deptNames: '',
    ownerName: 'E001、E002',
    followerName: 'F001',
    meetingSource: '办公会',
    raiseDate: '2026-07-30',
  }, { orgUsers, departments });

  assert.deepEqual(payload.ownerIds, ['u-owner-1', 'u-owner-2']);
  assert.deepEqual(payload.ownerNames, ['李承办', '丁敏']);
  assert.deepEqual(payload.deptNames, ['院长办公室', '科研处']);
  assert.equal(payload.ownerId, 'u-owner-1');
  assert.equal(payload.ownerName, '李承办');
});
