import test from 'node:test';
import assert from 'node:assert/strict';

import { Role } from '../../types';

test('detail actions use the exact normalized page context and hide unsupported actions', async () => {
  const detailActions = await import('./detail-actions').catch(() => ({}));
  const canUseDetailPageAction = (detailActions as {
    canUseDetailPageAction?: (user: { roleId: string }, roles: Role[], pageAuth: string, action: string) => boolean;
  }).canUseDetailPageAction;
  const roles: Role[] = [{
    id: 'workbench-sign',
    name: '工作台签收',
    authCodes: ['MENU_WORKBENCH'],
    dataScope: 'SELF',
    allowedActions: ['READ'],
    allowedPageActions: { MENU_WORKBENCH: ['SIGN_ITEM', 'DELETE_ITEM'] },
  }];

  assert.equal(typeof canUseDetailPageAction, 'function');
  assert.equal(canUseDetailPageAction?.({ roleId: 'workbench-sign' }, roles, 'MENU_WORKBENCH', 'SIGN_ITEM'), true);
  assert.equal(canUseDetailPageAction?.({ roleId: 'workbench-sign' }, roles, 'MENU_WORKBENCH', 'FEEDBACK_ITEM'), false);
  assert.equal(canUseDetailPageAction?.({ roleId: 'workbench-sign' }, roles, 'MENU_WORKBENCH', 'DELETE_ITEM'), false);
  assert.equal(canUseDetailPageAction?.({ roleId: 'workbench-sign' }, roles, 'MENU_ITEMS', 'SIGN_ITEM'), false);
});
