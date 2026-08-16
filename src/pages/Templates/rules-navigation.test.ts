import test from 'node:test';
import assert from 'node:assert/strict';

import { getGlobalRulesNavigation } from './rules-navigation.ts';
import type { Role } from '../../types';

const roles: Role[] = [
  {
    id: 'rules-only',
    name: '提醒策略管理员',
    authCodes: ['MENU_RULES'],
    dataScope: 'SELF',
  },
  {
    id: 'template-manager',
    name: '模板管理员',
    authCodes: ['MENU_TEMPLATES', 'MENU_RULES'],
    dataScope: 'SELF',
  },
];

test('getGlobalRulesNavigation keeps rules users on the rules page after applying settings', () => {
  assert.deepEqual(
    getGlobalRulesNavigation({ roleId: 'rules-only' }, roles),
    {
      backPath: '/templates/rules',
      backLabel: '返回系统设置',
      successPath: '/templates/rules',
    },
  );
});

test('getGlobalRulesNavigation returns template management when template access is available', () => {
  assert.deepEqual(
    getGlobalRulesNavigation({ roleId: 'template-manager' }, roles),
    {
      backPath: '/templates',
      backLabel: '返回模板管理',
      successPath: '/templates',
    },
  );
});
