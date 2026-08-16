import test from 'node:test';
import assert from 'node:assert/strict';

import { getProfileSystemSettingsState } from './profile-settings.ts';
import { Role } from '../../types';

const roles: Role[] = [
  {
    id: 'system',
    name: '系统配置员',
    authCodes: ['MENU_SYSTEM'],
    dataScope: 'SELF',
  },
  {
    id: 'org',
    name: '组织管理员',
    authCodes: ['MENU_ORG'],
    dataScope: 'DEPT',
  },
];

test('getProfileSystemSettingsState reuses the shared accessible settings path', () => {
  assert.deepEqual(
    getProfileSystemSettingsState({ roleId: 'org' }, roles),
    {
      path: '/settings/org',
      enabled: true,
    },
  );
});

test('getProfileSystemSettingsState disables the entry when the user has no settings access', () => {
  assert.deepEqual(
    getProfileSystemSettingsState({ roleId: 'missing' }, roles),
    {
      path: '/profile',
      enabled: false,
    },
  );
});
