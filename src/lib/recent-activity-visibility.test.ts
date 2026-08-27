import assert from 'node:assert/strict';
import { shouldShowRecentActivity } from './recent-activity-visibility';
import type { Role } from '../types';

const roles: Role[] = [
  { id: 'r1', name: '超级管理员', authCodes: ['ALL'], dataScope: 'ALL', followerDataScope: 'ALL' },
  { id: 'r2', name: '督办跟进人', authCodes: [], dataScope: 'SELF', followerDataScope: 'SELF' },
  { id: 'r3', name: '部门管理员', authCodes: [], dataScope: 'DEPT', followerDataScope: 'DEPT' },
  { id: 'r4dtsn6m', name: '督办管理员', authCodes: ['ALL'], dataScope: 'ALL', followerDataScope: 'ALL' },
  { id: 'r5', name: '组织管理员', authCodes: [], dataScope: 'MULTI_ORG', followerDataScope: 'MULTI_ORG' },
  { id: 'r6', name: '责任人', authCodes: [], dataScope: 'SELF' },
];

// 五类角色（按内置 ID）均不可见
for (const roleId of ['r1', 'r2', 'r3', 'r4dtsn6m', 'r6']) {
  assert.equal(
    shouldShowRecentActivity({ roleId, roleIds: [roleId] }, roles),
    false,
    `${roleId} 应隐藏最近动态`,
  );
}

// 组织管理员保持可见
assert.equal(shouldShowRecentActivity({ roleId: 'r5', roleIds: ['r5'] }, roles), true);

// 角色名匹配（含线上改名场景：责任人改为督办责任人）
assert.equal(
  shouldShowRecentActivity(
    { roleId: 'custom-x', roleIds: ['custom-x'] },
    [{ ...roles[5], id: 'custom-x', name: '督办责任人' }],
  ),
  false,
);
assert.equal(
  shouldShowRecentActivity(
    { roleId: 'custom-y', roleIds: ['custom-y'] },
    [{ ...roles[5], id: 'custom-y', name: ' 组织管理员 ' }],
  ),
  true,
);

// 多角色：命中任一隐藏角色即隐藏；仅组织管理员可见
assert.equal(shouldShowRecentActivity({ roleId: 'r5', roleIds: ['r5', 'r6'] }, roles), false);

// 兜底：无用户 / 无角色数据时默认可见
assert.equal(shouldShowRecentActivity(null, roles), true);
assert.equal(shouldShowRecentActivity({ roleId: undefined, roleIds: [] }, []), true);

console.log('recent-activity-visibility tests passed');
