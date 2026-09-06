import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateItemAutomation,
  getAutomationNotificationRecipients,
  getOverdueReminderRecipients,
} from './item-auto-engine';

const rules = { yellowLightDays: 3, redLightHours: 24, autoUrgeFrequency: 1 };
const now = new Date('2026-08-11T10:00:00+08:00');

test('server auto engine marks a single-owner item overdue from planned completion date', () => {
  const result = evaluateItemAutomation({
    id: 'item-1', title: '事项', status: 'EXECUTING', plannedCompletionDate: '2026-08-10',
    deadline: '2026-08-30', ownerId: 'owner-1', ownerName: '责任人', lightStatus: null,
  }, rules, now);

  assert.equal(result.itemUpdates.status, 'OVERDUE');
  assert.equal(result.itemUpdates.lightStatus, 'RED');
  assert.deepEqual(result.overdueOwners, [{ id: 'owner-1', name: '责任人' }]);
});

test('server auto engine updates only overdue subtasks and aggregates parent status', () => {
  const result = evaluateItemAutomation({
    id: 'item-2', title: '多责任人事项', status: 'EXECUTING', deadline: '2026-08-30',
    subTasks: [
      { id: 'a', assigneeId: 'a1', assigneeName: '甲', status: 'EXECUTING', plannedCompletionDate: '2026-08-10' },
      { id: 'b', assigneeId: 'b1', assigneeName: '乙', status: 'EXECUTING', plannedCompletionDate: '2026-08-20' },
    ],
  }, rules, now);

  const tasks = result.itemUpdates.subTasks as Array<{ id: string; status: string }>;
  assert.equal(tasks.find((task) => task.id === 'a')?.status, 'OVERDUE');
  assert.equal(tasks.find((task) => task.id === 'b')?.status, 'EXECUTING');
  assert.equal(result.itemUpdates.status, 'OVERDUE');
  assert.deepEqual(result.overdueOwners, [{ id: 'a1', name: '甲' }]);
});

test('server auto engine keeps an unsigned subtask pending even when its required date has passed', () => {
  const result = evaluateItemAutomation({
    id: 'item-pending-owner',
    title: '多责任人事项：未签收责任人不应超期',
    status: 'EXECUTING',
    deadline: '2026-08-30',
    subTasks: [
      { id: 'a', assigneeId: 'a1', assigneeName: '甲', status: 'EXECUTING', plannedCompletionDate: '2026-08-10' },
      // 乙没有签收，也没有填写计划完成日期；这里只保留立项时的要求完成日期。
      { id: 'b', assigneeId: 'b1', assigneeName: '乙', status: 'PENDING', requiredCompletionDate: '2026-08-01' },
    ],
  }, rules, now);

  const tasks = result.itemUpdates.subTasks as Array<{ id: string; status: string }>;
  assert.equal(tasks.find((task) => task.id === 'a')?.status, 'OVERDUE');
  assert.equal(tasks.find((task) => task.id === 'b')?.status, 'PENDING');
  assert.deepEqual(result.overdueOwners, [{ id: 'a1', name: '甲' }]);
  assert.equal(result.itemUpdates.status, 'OVERDUE');
});

test('server auto engine does not mark a pending single-owner item overdue before sign-in', () => {
  const result = evaluateItemAutomation({
    id: 'item-pending-single',
    title: '单责任人待签收事项',
    status: 'PENDING',
    requiredCompletionDate: '2026-08-01',
    ownerId: 'owner-1',
    ownerName: '责任人',
  }, rules, now);

  assert.equal(result.itemUpdates.status, undefined);
  assert.deepEqual(result.overdueOwners, []);
});

test('server auto engine keeps a delayed item delayed until its new planned completion date', () => {
  const result = evaluateItemAutomation({
    id: 'delayed-item',
    title: '已延期事项',
    status: 'DELAYED',
    plannedCompletionDate: '2026-08-20',
    deadline: '2026-08-01',
    ownerId: 'owner-1',
    ownerName: '责任人',
    lightStatus: null,
  }, rules, now);

  assert.equal(result.itemUpdates.status, undefined);
  assert.deepEqual(result.overdueOwners, []);
  assert.deepEqual(result.urgeOwners, [{ id: 'owner-1', name: '责任人' }]);
});

test('server auto engine excludes completed and archived subtasks from the parent light deadline', () => {
  const result = evaluateItemAutomation({
    id: 'active-subtask-deadline',
    title: '已办结子任务不能压红父事项',
    status: 'EXECUTING',
    deadline: '2026-09-30',
    lightStatus: null,
    subTasks: [
      { id: 'done', assigneeId: 'a', assigneeName: '甲', status: 'COMPLETED', plannedCompletionDate: '2026-08-01' },
      { id: 'archived', assigneeId: 'b', assigneeName: '乙', status: 'ARCHIVED', plannedCompletionDate: '2026-08-02' },
      { id: 'active', assigneeId: 'c', assigneeName: '丙', status: 'EXECUTING', plannedCompletionDate: '2026-09-15' },
    ],
  }, rules, now);

  assert.equal(result.nextLightStatus, null);
  assert.equal(result.itemUpdates.lightStatus, undefined);
});

test('server auto engine emits a green transition when an active item is no longer within a light threshold', () => {
  const result = evaluateItemAutomation({
    id: 'clear-light-item',
    title: '应自动解除亮灯的事项',
    status: 'EXECUTING',
    plannedCompletionDate: '2026-09-30',
    lightStatus: 'RED',
  }, rules, now);

  assert.equal(result.lightChanged, true);
  assert.equal(result.nextLightStatus, null);
  assert.equal(result.itemUpdates.lightStatus, null);
});

test('server auto engine honors auto-remind and auto-urge switches when selecting notification recipients', () => {
  const evaluation = {
    itemUpdates: {},
    overdueOwners: [{ id: 'overdue-owner', name: '超期责任人' }],
    urgeOwners: [{ id: 'urge-owner', name: '催办责任人' }],
    lightChanged: false,
    nextLightStatus: null,
  };

  assert.deepEqual(
    getAutomationNotificationRecipients(evaluation, { ...rules, autoRemindEnabled: false, autoUrgeEnabled: false }),
    { reminderOwners: [], autoUrgeOwners: [] },
  );
  assert.deepEqual(
    getAutomationNotificationRecipients(evaluation, { ...rules, autoRemindEnabled: true, autoUrgeEnabled: true }),
    { reminderOwners: evaluation.overdueOwners, autoUrgeOwners: evaluation.urgeOwners },
  );
  assert.deepEqual(
    getAutomationNotificationRecipients(evaluation, rules),
    { reminderOwners: evaluation.overdueOwners, autoUrgeOwners: [] },
  );
});

test('server auto engine sends overdue reminders to each active responsible person supervisor', () => {
  const evaluation = {
    itemUpdates: {},
    overdueOwners: [
      { id: 'owner-1', name: '责任人一' },
      { id: 'owner-2', name: '责任人二' },
      { id: 'owner-3', name: '责任人三' },
    ],
    urgeOwners: [],
    lightChanged: false,
    nextLightStatus: null,
  };
  const users = [
    { id: 'owner-1', name: '责任人一', supervisorId: 'leader-1', status: 'ACTIVE' },
    { id: 'owner-2', name: '责任人二', supervisorId: 'leader-1', status: 'ACTIVE' },
    { id: 'owner-3', name: '责任人三', supervisorId: 'leader-2', status: 'ACTIVE' },
    { id: 'leader-1', name: '领导一', supervisorId: null, status: 'ACTIVE' },
    { id: 'leader-2', name: '领导二', supervisorId: null, status: 'DISABLED' },
  ];

  assert.deepEqual(getOverdueReminderRecipients(evaluation, users), [
    { id: 'leader-1', name: '领导一' },
  ]);
  assert.deepEqual(
    getAutomationNotificationRecipients(evaluation, rules, getOverdueReminderRecipients(evaluation, users)),
    { reminderOwners: [{ id: 'leader-1', name: '领导一' }], autoUrgeOwners: [] },
  );
});

test('server auto engine leaves final and suspended items untouched', () => {
  for (const status of ['COMPLETED', 'ARCHIVED', 'DELETED', 'DISABLED', 'SUSPENDED']) {
    const result = evaluateItemAutomation({ id: status, status, deadline: '2026-08-01' }, rules, now);
    assert.deepEqual(result.itemUpdates, {});
    assert.deepEqual(result.urgeOwners, []);
  }
});
