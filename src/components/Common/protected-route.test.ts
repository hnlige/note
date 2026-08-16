import test from 'node:test';
import assert from 'node:assert/strict';

import { canEnterProtectedRoute } from './ProtectedRoute.tsx';
import { Role } from '../../types';

const roles: Role[] = [
  {
    id: 'limited-admin',
    name: '管理员配置漂移',
    authCodes: ['MENU_WORKBENCH'],
    dataScope: 'ALL',
  },
];

test('canEnterProtectedRoute requires menu authorization even when the technical role matches', () => {
  assert.equal(
    canEnterProtectedRoute({
      currentUser: { role: 'ADMIN', roleId: 'limited-admin' },
      roles,
      allowedRoles: ['ADMIN'],
      allowedAuthCodes: ['MENU_ROLES'],
    }),
    false,
  );
});

test('canEnterProtectedRoute rejects a user identity without an id', () => {
  assert.equal(
    canEnterProtectedRoute({
      currentUser: { role: 'ADMIN', roleId: 'limited-admin' },
      roles,
      allowedRoles: ['ADMIN'],
    }),
    false,
  );
});

test('canEnterProtectedRoute accepts an authenticated user with the required role', () => {
  assert.equal(
    canEnterProtectedRoute({
      currentUser: { id: 'user-1', role: 'ADMIN', roleId: 'limited-admin' },
      roles,
      allowedRoles: ['ADMIN'],
    }),
    true,
  );
});

test('recycle-bin route: non-ADMIN user with MENU_RECYCLE_BIN authCode can enter (regression for 无访问权限 bug)', () => {
  const recycleRoles: Role[] = [
    { id: 'owner-role', name: '组织负责人', authCodes: ['MENU_ITEMS', 'MENU_RECYCLE_BIN'], dataScope: 'MULTI_ORG' },
  ];
  // 角色为 OWNER（非 ADMIN）但持有 MENU_RECYCLE_BIN —— 修复后应当放行。
  assert.equal(
    canEnterProtectedRoute({
      currentUser: { id: 'u2', role: 'OWNER', roleId: 'owner-role' },
      roles: recycleRoles,
      allowedRoles: ['ADMIN', 'OWNER', 'FOLLOWER'],
      allowedAuthCodes: ['MENU_RECYCLE_BIN'],
    }),
    true,
  );
  // 角色为 OWNER 但不持有 MENU_RECYCLE_BIN —— 仍应被拒。
  assert.equal(
    canEnterProtectedRoute({
      currentUser: { id: 'u3', role: 'OWNER', roleId: 'owner-role' },
      roles: recycleRoles,
      allowedRoles: ['ADMIN', 'OWNER', 'FOLLOWER'],
      allowedAuthCodes: ['MENU_AUDIT'],
    }),
    false,
  );
});
