import test from 'node:test';
import assert from 'node:assert/strict';

import { getSystemSettingsPath } from './header-settings.ts';
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
  {
    id: 'tasks',
    name: '任务管理员',
    authCodes: ['MENU_TASKS'],
    dataScope: 'SELF',
  },
];

test('getSystemSettingsPath prefers system config when MENU_SYSTEM is available', () => {
  assert.equal(getSystemSettingsPath({ roleId: 'system' }, roles), '/settings/config');
});
test('getSystemSettingsPath falls back to the first accessible settings page', () => {
  assert.equal(getSystemSettingsPath({ roleId: 'org' }, roles), '/settings/org');
  assert.equal(getSystemSettingsPath({ roleId: 'tasks' }, roles), '/system/tasks');
});

test('getSystemSettingsPath returns profile when no settings permissions are available', () => {
  assert.equal(getSystemSettingsPath({ roleId: 'missing' }, roles), '/profile');
});
