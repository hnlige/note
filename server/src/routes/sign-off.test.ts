import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSignOffStatus,
  allOwnersSignedAfter,
  getItemOwnerNames,
  getSignedOwnerNames,
} from './sign-off';

function ownerItem(ownerNames: string[], timeline: { type: string; user: string }[] = []) {
  return { ownerNames, timeline };
}

test('getItemOwnerNames 提取去重后的责任人姓名', () => {
  assert.deepEqual(getItemOwnerNames({ ownerName: '张三', ownerNames: ['李四', '张三', ''] }), ['张三', '李四']);
  assert.deepEqual(getItemOwnerNames({ ownerId: 'u1' }), []);
});

test('getSignedOwnerNames 仅统计 SIGN 节点', () => {
  const tl = [
    { type: 'SIGN', user: '张三' },
    { type: 'FEEDBACK', user: '李四' },
    { type: 'SIGN', user: ' 王五 ' },
  ];
  assert.deepEqual([...getSignedOwnerNames(tl)], ['张三', '王五']);
});

test('无责任人时视为已签收', () => {
  assert.deepEqual(computeSignOffStatus({ ownerNames: [] }), { status: 'SIGNED', signedCount: 0, totalCount: 0 });
});

test('单责任人：未签收 / 已签收', () => {
  assert.deepEqual(
    computeSignOffStatus(ownerItem(['张三'])),
    { status: 'NOT_SIGNED', signedCount: 0, totalCount: 1 },
  );
  assert.deepEqual(
    computeSignOffStatus(ownerItem(['张三'], [{ type: 'SIGN', user: '张三' }])),
    { status: 'SIGNED', signedCount: 1, totalCount: 1 },
  );
});

test('多责任人：独立签收（部分签收 PARTIAL，互不干扰）', () => {
  const item = ownerItem(['张三', '李四']);
  // 仅张三签收 → 部分签收
  assert.deepEqual(
    computeSignOffStatus(item, [{ type: 'SIGN', user: '张三' }]),
    { status: 'PARTIAL', signedCount: 1, totalCount: 2 },
  );
  // 张三 + 李四均签收 → 已签收
  assert.deepEqual(
    computeSignOffStatus(item, [{ type: 'SIGN', user: '张三' }, { type: 'SIGN', user: '李四' }]),
    { status: 'SIGNED', signedCount: 2, totalCount: 2 },
  );
  // 李四签收、张三未签 → 仍为部分签收（各人独立，不影响他人）
  assert.deepEqual(
    computeSignOffStatus(item, [{ type: 'SIGN', user: '李四' }]),
    { status: 'PARTIAL', signedCount: 1, totalCount: 2 },
  );
  // 责任人姓名须精确匹配（王五非责任人）
  assert.deepEqual(
    computeSignOffStatus(item, [{ type: 'SIGN', user: '王五' }]),
    { status: 'NOT_SIGNED', signedCount: 0, totalCount: 2 },
  );
});

test('签收优先按稳定用户 ID 匹配，避免同名误判', () => {
  const item = { ownerIds: ['u1', 'u2'], ownerNames: ['同名用户', '同名用户'] };
  assert.deepEqual(
    computeSignOffStatus(item, [{ type: 'SIGN', user: '同名用户', actorUserId: 'u1' }]),
    { status: 'PARTIAL', signedCount: 1, totalCount: 2 },
  );
});

test('历史子任务已离开待签收但缺少 SIGN 时间轴时，仍按责任人汇总为已签收', () => {
  const item = {
    ownerIds: ['u1', 'u2', 'u3'],
    ownerNames: ['张三', '李四', '王五'],
    subTasks: [
      { assigneeId: 'u1', assigneeName: '张三', status: 'OVERDUE', plannedCompletionDate: '2026-08-01' },
      { assigneeId: 'u2', assigneeName: '李四', status: 'EXECUTING', plannedCompletionDate: '2026-08-02' },
      { assigneeId: 'u3', assigneeName: '王五', status: 'PENDING' },
      { assigneeId: 'other', assigneeName: '无关人员', status: 'COMPLETED' },
    ],
  };

  assert.deepEqual(computeSignOffStatus(item, []), { status: 'PARTIAL', signedCount: 2, totalCount: 3 });
});

test('反馈自动推进但没有 SIGN 和计划完成日期的子任务仍为未签收', () => {
  const item = {
    ownerIds: ['u1', 'u2'],
    ownerNames: ['魏红义', '申林'],
    subTasks: [
      { assigneeId: 'u1', assigneeName: '魏红义', status: 'EXECUTING' },
      { assigneeId: 'u2', assigneeName: '申林', status: 'EXECUTING' },
    ],
  };
  assert.deepEqual(
    computeSignOffStatus(item, [{ type: 'SIGN', user: '魏红义', actorUserId: 'u1' }]),
    { status: 'PARTIAL', signedCount: 1, totalCount: 2 },
  );
});

test('已有子任务时以子任务状态为准，PENDING 不被历史 SIGN 时间轴误算为已签收', () => {
  const item = {
    ownerIds: ['u1', 'u2', 'u3'],
    ownerNames: ['牛绍宇', '魏红义', '申林'],
    subTasks: [
      { assigneeId: 'u1', assigneeName: '牛绍宇', status: 'PENDING' },
      { assigneeId: 'u2', assigneeName: '魏红义', status: 'PENDING' },
      { assigneeId: 'u3', assigneeName: '申林', status: 'PENDING' },
    ],
  };

  assert.deepEqual(
    computeSignOffStatus(item, [{ type: 'SIGN', user: '牛绍宇', actorUserId: 'u1' }]),
    { status: 'NOT_SIGNED', signedCount: 0, totalCount: 3 },
  );
});

test('已删除的历史子任务不能补偿为已签收', () => {
  assert.deepEqual(
    computeSignOffStatus({
      ownerIds: ['u1'],
      ownerNames: ['张三'],
      subTasks: [{ assigneeId: 'u1', assigneeName: '张三', status: 'DELETED' }],
    }, []),
    { status: 'NOT_SIGNED', signedCount: 0, totalCount: 1 },
  );
});

test('allOwnersSignedAfter：签收门槛判定（含本次操作人）', () => {
  const item = ownerItem(['张三', '李四']);
  // 已有张三的 SIGN 节点，本次李四签收
  const existing = [{ type: 'SIGN', user: '张三' }];
  const incoming = [{ type: 'SIGN', user: '李四' }];
  assert.equal(allOwnersSignedAfter(item, existing, incoming, '李四'), true);
  // 本次仅李四签收，张三历史未签 → 仍不全
  assert.equal(allOwnersSignedAfter(item, [], incoming, '李四'), false);
  // 无责任人 → 视为已齐
  assert.equal(allOwnersSignedAfter({ ownerNames: [] }, [], [], '张三'), true);
});
