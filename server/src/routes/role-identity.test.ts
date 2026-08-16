import test from 'node:test';
import assert from 'node:assert/strict';

import { getAssignedRoleIds, getPrimaryAssignedRole, isFollowerRoleIdentity, resolveDisplayRoleName } from './role-identity';

const roles = [
  { id: 'r2', name: '督办跟进人' },
  { id: 'r4dtsn6m', name: '督办管理员' },
  { id: 'r6', name: '督办责任人' },
];

test('getAssignedRoleIds prioritizes roleId and de-duplicates roleIds', () => {
  assert.deepEqual(getAssignedRoleIds({ roleId: 'r6', roleIds: ['r6', 'r2'] }), ['r6', 'r2']);
});

test('getPrimaryAssignedRole resolves renamed built-in roles by roleId', () => {
  assert.deepEqual(
    getPrimaryAssignedRole({ role: '责任人', roleId: 'r6' }, roles),
    { id: 'r6', name: '督办责任人' },
  );
});

test('resolveDisplayRoleName prefers role config name over stale user.role text', () => {
  assert.equal(resolveDisplayRoleName({ role: '责任人', roleId: 'r6' }, roles), '督办责任人');
});

test('isFollowerRoleIdentity accepts renamed follower roles by roleId', () => {
  assert.equal(isFollowerRoleIdentity({ role: '综合跟进岗', roleId: 'r2' }), true);
  assert.equal(isFollowerRoleIdentity({ role: '督办责任人', roleId: 'r6' }), false);
});
