import test from 'node:test';
import assert from 'node:assert/strict';

import { SupervisionItem, SubTask, TimelineNode } from '../../../types';
import { buildWorkbenchStatusMetrics, isUserWorkbenchItem } from './workbench-metrics';

function subTask(name: string, status: SubTask['status'], extra: Partial<SubTask> = {}): SubTask {
  return {
    id: `sub-${name}`,
    title: `子任务-${name}`,
    deadline: '2026-08-31',
    status,
    assigneeId: `id-${name}`,
    assigneeName: name,
    progress: 0,
    ...extra,
  };
}

const baseItem: SupervisionItem = {
  id: 'item-base',
  serialNo: 'DB-BASE',
  title: '测试事项',
  content: '测试内容',
  status: 'PENDING',
  deadline: '2026-08-31',
  ownerId: 'owner-1',
  ownerName: '负责人',
  followerId: 'follower-1',
  followerName: '跟进人',
  progress: 0,
  category: '测试',
  campus: '总部',
  timeline: [],
};

function item(overrides: Partial<SupervisionItem>): SupervisionItem {
  return {
    ...baseItem,
    ...overrides,
    id: overrides.id || `item-${overrides.status || 'pending'}`,
    serialNo: overrides.serialNo || `DB-${overrides.id || overrides.status || 'PENDING'}`,
    timeline: overrides.timeline || [],
  };
}

function valuesByTitle(items: SupervisionItem[], mode: 'person' | 'item' = 'person') {
  return Object.fromEntries(buildWorkbenchStatusMetrics(items, mode).map(metric => [metric.title, metric.value]));
}

function captionByTitle(items: SupervisionItem[], mode: 'person' | 'item' = 'person') {
  return Object.fromEntries(buildWorkbenchStatusMetrics(items, mode).map(metric => [metric.title, metric.caption]));
}

/* ----------------------------- person 模式（纯责任人视角） ----------------------------- */

test('person：单责任人计数（与旧事项级在单责时结果一致）', () => {
  const values = valuesByTitle([
    item({ id: 'pending', status: 'PENDING', ownerName: '张三', subTasks: [subTask('张三', 'PENDING')] }),
    item({
      id: 'overdue',
      status: 'OVERDUE',
      ownerName: '张三',
      subTasks: [subTask('张三', 'OVERDUE')],
      timeline: [{ id: 'sign-overdue', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' }],
    }),
    item({
      id: 'delayed-feedback',
      status: 'DELAYED',
      ownerName: '张三',
      subTasks: [subTask('张三', 'DELAYED')],
      timeline: [
        { id: 'sign-delayed', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' },
        { id: 'fb-delayed', type: 'FEEDBACK', user: '张三', content: '已反馈', timestamp: '2026-07-02 09:00' },
      ],
    }),
    item({
      id: 'executing-no-feedback',
      status: 'EXECUTING',
      ownerName: '张三',
      subTasks: [subTask('张三', 'EXECUTING')],
      timeline: [{ id: 'sign-executing', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-03 09:00' }],
    }),
    item({
      id: 'completed',
      status: 'COMPLETED',
      ownerName: '张三',
      subTasks: [subTask('张三', 'COMPLETED')],
      timeline: [
        { id: 'sign-completed', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' },
        { id: 'fb-completed', type: 'FEEDBACK', user: '张三', content: '已反馈', timestamp: '2026-07-02 09:00' },
      ],
    }),
    item({ id: 'completed-unsigned', status: 'COMPLETED', ownerName: '张三', subTasks: [subTask('张三', 'COMPLETED')] }),
    item({ id: 'deleted', status: 'DELETED', ownerName: '张三', subTasks: [subTask('张三', 'PENDING')] }),
  ]);

  assert.deepEqual(values, {
    待签收: 1,
    已超期: 2,
    未反馈: 2,
    未完成: 4,
    已完成: 2,
  });
});

test('person：多责任人待签收 = 未签收责任人数（5责，2签3未签 → 3）', () => {
  const values = valuesByTitle([
    item({
      id: 'multi-sign',
      status: 'EXECUTING',
      ownerName: '张三',
      ownerNames: ['张三', '李四', '王五', '赵六', '钱七'],
      subTasks: [
        subTask('张三', 'EXECUTING'),
        subTask('李四', 'EXECUTING'),
        subTask('王五', 'PENDING'),
        subTask('赵六', 'PENDING'),
        subTask('钱七', 'PENDING'),
      ],
      timeline: [
        { id: 's1', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' },
        { id: 's2', type: 'SIGN', user: '李四', content: '签收', timestamp: '2026-07-01 09:01' },
      ],
    }),
  ]);

  assert.equal(values.待签收, 3, '待签收 = 未签收责任人 3');
  assert.equal(values.未完成, 5, '全部未完成');
  assert.equal(values.未反馈, 2, '已签收且未反馈 2 人');
  assert.equal(values.已超期, 0);
  assert.equal(values.已完成, 0);
});

test('person：多责任人已超期 = 子任务 OVERDUE/DELAYED 责任人数（5责，1超时1延期 → 2）', () => {
  const values = valuesByTitle([
    item({
      id: 'multi-overdue',
      status: 'OVERDUE',
      ownerName: '张三',
      ownerNames: ['张三', '李四', '王五', '赵六', '钱七'],
      subTasks: [
        subTask('张三', 'OVERDUE'),
        subTask('李四', 'DELAYED'),
        subTask('王五', 'EXECUTING'),
        subTask('赵六', 'EXECUTING'),
        subTask('钱七', 'EXECUTING'),
      ],
      timeline: ['张三', '李四', '王五', '赵六', '钱七'].map((n, i) => ({
        id: `s${i}`,
        type: 'SIGN',
        user: n,
        content: '签收',
        timestamp: '2026-07-01 09:00',
      } as TimelineNode)),
    }),
  ]);

  assert.equal(values.已超期, 2, '已超期 = 超时1 + 延期1 = 2');
  assert.equal(values.待签收, 0, '全部已签收');
  assert.equal(values.未完成, 5);
  assert.equal(values.未反馈, 5, '已签收且无反馈（无 FEEDBACK 节点）');
});

test('person：未反馈不含未签收（5责，2签无反馈，3未签 → 未反馈=2，待签收=3）', () => {
  const values = valuesByTitle([
    item({
      id: 'multi-nofb',
      status: 'EXECUTING',
      ownerName: '张三',
      ownerNames: ['张三', '李四', '王五', '赵六', '钱七'],
      subTasks: [
        subTask('张三', 'EXECUTING'),
        subTask('李四', 'EXECUTING'),
        subTask('王五', 'PENDING'),
        subTask('赵六', 'PENDING'),
        subTask('钱七', 'PENDING'),
      ],
      timeline: [
        { id: 's1', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' },
        { id: 's2', type: 'SIGN', user: '李四', content: '签收', timestamp: '2026-07-01 09:01' },
      ],
    }),
  ]);

  assert.equal(values.待签收, 3, '3 人未签收');
  assert.equal(values.未反馈, 2, '未反馈仅含已签收且无反馈的 2 人，不含未签收');
});

test('person：未反馈 = 已签收且无反馈责任人数（5责，2反馈3未反馈 → 3）', () => {
  const values = valuesByTitle([
    item({
      id: 'multi-nofb2',
      status: 'EXECUTING',
      ownerName: '张三',
      ownerNames: ['张三', '李四', '王五', '赵六', '钱七'],
      subTasks: Array(5).fill(0).map((_, i) => subTask(`责任人${i}`, 'EXECUTING')),
      timeline: [
        ...Array(5).fill(0).map((_, i) => ({ id: `s${i}`, type: 'SIGN', user: `责任人${i}`, content: '签收', timestamp: '2026-07-01 09:00' } as TimelineNode)),
        { id: 'fb0', type: 'FEEDBACK', user: '责任人0', content: '已反馈', timestamp: '2026-07-02 09:00' },
        { id: 'fb1', type: 'FEEDBACK', user: '责任人1', content: '已反馈', timestamp: '2026-07-02 09:01' },
      ],
    }),
  ]);

  assert.equal(values.未反馈, 3, '未反馈 = 5 - 已反馈2 = 3');
  assert.equal(values.待签收, 0);
});

test('person：未完成/已完成按子任务状态（5责，2办结3未办结 → 未完成=3，已完成=2）', () => {
  const values = valuesByTitle([
    item({
      id: 'multi-comp',
      status: 'EXECUTING',
      ownerName: '张三',
      ownerNames: ['张三', '李四', '王五', '赵六', '钱七'],
      subTasks: [
        subTask('张三', 'COMPLETED'),
        subTask('李四', 'COMPLETED'),
        subTask('王五', 'EXECUTING'),
        subTask('赵六', 'EXECUTING'),
        subTask('钱七', 'OVERDUE'),
      ],
      timeline: ['张三', '李四', '王五', '赵六', '钱七'].map((n, i) => ({
        id: `s${i}`,
        type: 'SIGN',
        user: n,
        content: '签收',
        timestamp: '2026-07-01 09:00',
      } as TimelineNode)),
    }),
  ]);

  assert.equal(values.未完成, 3, '未完成 = 2办结外其余 3 人');
  assert.equal(values.已完成, 2, '已完成 = 2 办结');
  assert.equal(values.已超期, 1, '钱七超时计入已超期');
});

test('person：caption 标注「涉及 N 件督办」', () => {
  const captions = captionByTitle([
    item({
      id: 'multi-sign',
      status: 'EXECUTING',
      ownerName: '张三',
      ownerNames: ['张三', '李四', '王五', '赵六', '钱七'],
      subTasks: [
        subTask('张三', 'EXECUTING'),
        subTask('李四', 'EXECUTING'),
        subTask('王五', 'PENDING'),
        subTask('赵六', 'PENDING'),
        subTask('钱七', 'PENDING'),
      ],
      timeline: [
        { id: 's1', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' },
        { id: 's2', type: 'SIGN', user: '李四', content: '签收', timestamp: '2026-07-01 09:01' },
      ],
    }),
  ]);
  // 1 件督办，待签收3/未反馈2/未完成5 均涉及该 1 件
  assert.equal(captions.待签收, '涉及 1 件督办');
  assert.equal(captions.未反馈, '涉及 1 件督办');
  assert.equal(captions.未完成, '涉及 1 件督办');
});

/* ----------------------------- item 模式（领导/管理员/跟进人视角） ----------------------------- */

test('item：按督办事项数计数（多责任人事项每块最多计 1）', () => {
  const values = valuesByTitle([
    // 1 件：5责，3未签 → item 模式待签收=1（事项级），person 模式待签收=3
    item({
      id: 'multi-sign',
      status: 'EXECUTING',
      ownerName: '张三',
      ownerNames: ['张三', '李四', '王五', '赵六', '钱七'],
      subTasks: [
        subTask('张三', 'EXECUTING'),
        subTask('李四', 'EXECUTING'),
        subTask('王五', 'PENDING'),
        subTask('赵六', 'PENDING'),
        subTask('钱七', 'PENDING'),
      ],
      timeline: [
        { id: 's1', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' },
        { id: 's2', type: 'SIGN', user: '李四', content: '签收', timestamp: '2026-07-01 09:01' },
      ],
    }),
    // 1 件：单责已签无反馈超时 → 已超期/未反馈/未完成 各 1
    item({
      id: 'single-overdue',
      status: 'OVERDUE',
      ownerName: '张三',
      subTasks: [subTask('张三', 'OVERDUE')],
      timeline: [{ id: 'so', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' }],
    }),
    // 1 件：已办结 → 已完成 1
    item({
      id: 'single-completed',
      status: 'COMPLETED',
      ownerName: '张三',
      subTasks: [subTask('张三', 'COMPLETED')],
      timeline: [{ id: 'sc', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' }],
    }),
    // 1 件：多责任人全签无反馈 → item 模式仍只占 1 件（未反馈+1、未完成+1）
    item({
      id: 'multi-all-signed',
      status: 'EXECUTING',
      ownerName: '责任人0',
      ownerNames: ['责任人0', '责任人1', '责任人2', '责任人3', '责任人4'],
      subTasks: Array(5).fill(0).map((_, i) => subTask(`责任人${i}`, 'EXECUTING')),
      timeline: Array(5).fill(0).map((_, i) => ({ id: `s${i}`, type: 'SIGN', user: `责任人${i}`, content: '签收', timestamp: '2026-07-01 09:00' } as TimelineNode)),
    }),
    // 已删除不参与
    item({ id: 'deleted', status: 'DELETED', ownerName: '张三', subTasks: [subTask('张三', 'PENDING')] }),
  ], 'item');

  assert.deepEqual(values, {
    待签收: 1,
    已超期: 1,
    未反馈: 2,
    未完成: 3,
    已完成: 1,
  }, 'item 模式按事项数，多责任人事项只占 1 件');
});

test('item：caption 标注「督办事项」', () => {
  const captions = captionByTitle([
    item({
      id: 'single',
      status: 'OVERDUE',
      ownerName: '张三',
      subTasks: [subTask('张三', 'OVERDUE')],
      timeline: [{ id: 'so', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' }],
    }),
  ], 'item');
  assert.equal(captions.已超期, '督办事项');
  assert.equal(captions.待签收, '督办事项');
});

/* ----------------------------- 下钻参数（两种模式一致） ----------------------------- */

test('下钻链接参数与标题保持与现有查询一致', () => {
  const metrics = buildWorkbenchStatusMetrics([]);

  assert.deepEqual(
    metrics.map(metric => [metric.title, metric.path, metric.params]),
    [
      ['待签收', '/items', '?pendingOpen=1'],
      ['已超期', '/items', '?status=OVERDUE,DELAYED'],
      ['未反馈', '/items', '?noFeedback=1'],
      ['未完成', '/items', '?incomplete=1'],
      ['已完成', '/items', '?status=COMPLETED'],
    ],
  );
});

/* ----------------------------- person 模式 + currentUser 过滤（责任人只看自己） ----------------------------- */

/** 带 currentUser 的快捷取值 */
function valuesByUser(items: SupervisionItem[], user: { id: string; name: string; username: string }) {
  return Object.fromEntries(buildWorkbenchStatusMetrics(items, 'person', user).map(metric => [metric.title, metric.value]));
}

test('person+currentUser：多责任人事项只统计当前用户自己的任务（5责3未签，魏红义未签→待签收=1）', () => {
  // 场景：5个责任人，张三/李四已签，王五/赵六/钱七未签；魏红义是其中1个未签人
  const 魏红义 = { id: 'user-weihy', name: '魏红义', username: 'weihy' };
  const values = valuesByUser([
    item({
      id: 'multi-filter',
      status: 'EXECUTING',
      ownerName: '张三',
      ownerNames: ['张三', '李四', '王五', '魏红义', '赵六'],
      ownerId: 'id-张三',
      subTasks: [
        subTask('张三', 'EXECUTING'),
        subTask('李四', 'EXECUTING'),
        subTask('王五', 'PENDING'),
        subTask('魏红义', 'PENDING'),   // ← 魏红义的待签收
        subTask('赵六', 'PENDING'),
      ],
      timeline: [
        { id: 's1', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' },
        { id: 's2', type: 'SIGN', user: '李四', content: '签收', timestamp: '2026-07-01 09:01' },
      ],
    }),
  ], 魏红义);

  assert.equal(values.待签收, 1, '魏红义本人待签收 = 1（不是全部 3 个未签）');
  assert.equal(values.未完成, 1, '魏红义本人未完成 = 1（不是全部 5 个）');
  assert.equal(values.未反馈, 0, '魏红义未签收，不计入未反馈');
  assert.equal(values.已超期, 0);
  assert.equal(values.已完成, 0);
});

test('person+currentUser：事项级 ownerId 命中本人时，仍只统计本人 assigneeId/assigneeName 子任务', () => {
  const 魏红义 = { id: 'user-weihy', name: '魏红义', username: 'weihy' };
  const values = valuesByUser([
    item({
      id: 'primary-owner-with-multiple-subtasks',
      status: 'EXECUTING',
      ownerId: 魏红义.id,
      ownerName: 魏红义.name,
      ownerIds: [魏红义.id, 'user-zs', 'user-ls', 'user-ww'],
      ownerNames: [魏红义.name, '张三', '李四', '王五'],
      subTasks: [
        { ...subTask('魏红义', 'PENDING'), assigneeId: 魏红义.id },
        { ...subTask('张三', 'OVERDUE'), assigneeId: 'user-zs' },
        { ...subTask('李四', 'EXECUTING'), assigneeId: 'user-ls' },
        { ...subTask('王五', 'COMPLETED'), assigneeId: 'user-ww' },
      ],
      timeline: [
        { id: 'sign-zs', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' },
        { id: 'feedback-zs', type: 'FEEDBACK', user: '张三', content: '反馈', timestamp: '2026-07-02 09:00' },
        { id: 'sign-ls', type: 'SIGN', user: '李四', content: '签收', timestamp: '2026-07-01 09:01' },
        { id: 'sign-ww', type: 'SIGN', user: '王五', content: '签收', timestamp: '2026-07-01 09:02' },
      ],
    }),
  ], 魏红义);

  assert.deepEqual(values, {
    待签收: 1,
    已超期: 0,
    未反馈: 0,
    未完成: 1,
    已完成: 0,
  }, '不得把同一事项中张三/李四/王五的状态计到事项级主责任人魏红义名下');
});

test('person+currentUser：多责任人子任务已进入执行态时，即使历史 SIGN 时间轴缺失也不再算待签收', () => {
  const 魏红义 = { id: 'user-weihy', name: '魏红义', username: 'weihy' };
  const values = valuesByUser([
    item({
      id: 'signed-status-without-timeline',
      status: 'EXECUTING',
      ownerId: 魏红义.id,
      ownerName: 魏红义.name,
      subTasks: [
        { ...subTask('魏红义', 'EXECUTING'), assigneeId: 魏红义.id },
        { ...subTask('张三', 'PENDING'), assigneeId: 'user-zs' },
      ],
      timeline: [],
    }),
  ], 魏红义);

  assert.equal(values.待签收, 0, '本人子任务已进入 EXECUTING，不因接口缺少历史 SIGN 节点而重复待签');
  assert.equal(values.未反馈, 1, '已签收且尚无本人反馈，应进入未反馈');
  assert.equal(values.未完成, 1);
});

test('person+currentUser：无 subTasks 的旧单责任人数据才使用事项级 ownerId/ownerName 兜底', () => {
  const 魏红义 = { id: 'user-weihy', name: '魏红义', username: 'weihy' };
  const values = valuesByUser([
    item({
      id: 'legacy-single-owner',
      status: 'PENDING',
      ownerId: 魏红义.id,
      ownerName: '历史责任人姓名',
      ownerNames: ['历史责任人姓名'],
      subTasks: [],
    }),
  ], 魏红义);

  assert.equal(values.待签收, 1);
  assert.equal(values.未完成, 1);
});

test('person+currentUser：多事项多责任人，跨事项只统计自己的（魏红义在A未签、B已签有反馈→待签收=1未反馈=0）', () => {
  const 魏红义 = { id: 'user-weihy', name: '魏红义', username: 'weihy' };
  const values = valuesByUser([
    // 事项A：魏红义未签收
    item({
      id: 'item-a',
      status: 'EXECUTING',
      ownerName: '张三',
      subTasks: [subTask('张三', 'EXECUTING'), subTask('魏红义', 'PENDING')],
      timeline: [{ id: 'sa', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' }],
    }),
    // 事项B：魏红义已签收但无反馈
    item({
      id: 'item-b',
      status: 'DELAYED',
      ownerName: '李四',
      subTasks: [subTask('李四', 'DELAYED'), subTask('魏红义', 'DELAYED')],
      timeline: [
        { id: 'sb1', type: 'SIGN', user: '李四', content: '签收', timestamp: '2026-07-02 09:00' },
        { id: 'sb2', type: 'SIGN', user: '魏红义', content: '签收', timestamp: '2026-07-02 09:01' },
        // 李四有反馈，魏红义没有
        { id: 'fb1', type: 'FEEDBACK', user: '李四', content: '已反馈', timestamp: '2026-07-03 09:00' },
      ],
    }),
  ], 魏红义);

  assert.equal(values.待签收, 1, '事项A中魏红义未签收');
  assert.equal(values.未反馈, 1, '事项B中魏红义已签无反馈');
  assert.equal(values.已超期, 1, '事项B中魏红义超期(DELAYED)');
  assert.equal(values.未完成, 2, '两个任务都未完成');
});

test('person+currentUser：单责任人事项（自己是唯一责任人，结果与不传 currentUser 一致）', () => {
  const 张三 = { id: 'user-zs', name: '张三', username: 'zhangsan' };
  const values = valuesByUser([
    item({ id: 'single', status: 'PENDING', ownerName: '张三', subTasks: [subTask('张三', 'PENDING')] }),
  ], 张三);

  assert.equal(values.待签收, 1);
  assert.equal(values.未完成, 1);
});

test('person+currentUser：用户不在该事项责任人中 → 该事项不计入任何卡片', () => {
  const 路人 = { id: 'user-lr', name: '路人甲', username: 'luren' };
  const values = valuesByUser([
    item({
      id: 'not-involved',
      status: 'EXECUTING',
      ownerName: '张三',
      subTasks: [subTask('张三', 'EXECUTING'), subTask('李四', 'PENDING')],
      timeline: [{ id: 's', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' }],
    }),
  ], 路人);

  assert.deepEqual(values, { 待签收: 0, 已超期: 0, 未反馈: 0, 未完成: 0, 已完成: 0 });
});

test('person 无 currentUser 参数时保持向后兼容（统计所有责任人，行为不变）', () => {
  // 不传 currentUser → 行为与修改前一致：统计所有责任人
  const values = valuesByTitle([
    item({
      id: 'compat',
      status: 'EXECUTING',
      ownerName: '张三',
      subTasks: [subTask('张三', 'PENDING'), subTask('李四', 'PENDING')],
    }),
  ]);
  assert.equal(values.待签收, 2, '无 currentUser 时统计所有责任人（向后兼容）');
});

/* ----------------------------- isUserWorkbenchItem（下钻列表与首页一一对应） ----------------------------- */

const 魏红义 = { id: 'user-weihy', name: '魏红义', username: 'weihy' };

/** 构造一组混合事项：覆盖"本人签/未签 × 他人签/未签"的组合 */
function mixedItems() {
  return [
    // 魏红义未签、他人也未签 → 魏红义待签收命中
    item({
      id: 'a',
      status: 'EXECUTING',
      ownerName: '张三',
      ownerIds: ['id-张三', 'user-weihy'],
      subTasks: [subTask('张三', 'EXECUTING'), subTask('魏红义', 'PENDING')],
      timeline: [{ id: 'sa', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' }],
    }),
    // 魏红义已签、但他人未签 → 魏红义本人不命中待签收（首页待签收不计魏红义）
    item({
      id: 'b',
      status: 'EXECUTING',
      ownerName: '张三',
      ownerIds: ['id-张三', 'user-weihy'],
      subTasks: [subTask('张三', 'PENDING'), subTask('魏红义', 'EXECUTING')],
      timeline: [{ id: 'sb', type: 'SIGN', user: '魏红义', content: '签收', timestamp: '2026-07-02 09:00' }],
    }),
    // 魏红义已签无反馈、他人已签无反馈 → 魏红义未反馈命中
    item({
      id: 'c',
      status: 'EXECUTING',
      ownerName: '张三',
      ownerIds: ['id-张三', 'user-weihy'],
      subTasks: [subTask('张三', 'EXECUTING'), subTask('魏红义', 'EXECUTING')],
      timeline: [
        { id: 'sc1', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' },
        { id: 'sc2', type: 'SIGN', user: '魏红义', content: '签收', timestamp: '2026-07-02 09:00' },
      ],
    }),
    // 魏红义子任务 OVERDUE、他人 EXECUTING → 魏红义已超期命中
    item({
      id: 'd',
      status: 'OVERDUE',
      ownerName: '张三',
      ownerIds: ['id-张三', 'user-weihy'],
      subTasks: [subTask('张三', 'EXECUTING'), subTask('魏红义', 'OVERDUE')],
      timeline: [
        { id: 'sd1', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' },
        { id: 'sd2', type: 'SIGN', user: '魏红义', content: '签收', timestamp: '2026-07-02 09:00' },
      ],
    }),
    // 魏红义子任务 COMPLETED、他人 EXECUTING → 魏红义已完成命中
    item({
      id: 'e',
      status: 'EXECUTING',
      ownerName: '张三',
      ownerIds: ['id-张三', 'user-weihy'],
      subTasks: [subTask('张三', 'EXECUTING'), subTask('魏红义', 'COMPLETED')],
      timeline: [
        { id: 'se1', type: 'SIGN', user: '张三', content: '签收', timestamp: '2026-07-01 09:00' },
        { id: 'se2', type: 'SIGN', user: '魏红义', content: '签收', timestamp: '2026-07-02 09:00' },
      ],
    }),
  ];
}

test('isUserWorkbenchItem：待签收只看本人子任务——本人已签他人未签的事项不命中', () => {
  const items = mixedItems();
  // 事项b：魏红义已签，他人未签 → 事项级"未全部签收"为真，但本人待签收应为假
  const itemB = items.find(i => i.id === 'b')!;
  assert.equal(isUserWorkbenchItem('pendingOpen', itemB, 魏红义), false, '魏红义已签→本人待签收=false（修正前会被事项级误判为 true）');
  // 事项a：魏红义未签 → 命中
  const itemA = items.find(i => i.id === 'a')!;
  assert.equal(isUserWorkbenchItem('pendingOpen', itemA, 魏红义), true, '魏红义未签→本人待签收=true');
});

test('isUserWorkbenchItem：与首页 person 数字一一对应（下钻条数=卡片数字）', () => {
  const items = mixedItems();
  // 首页 person 模式数字（魏红义视角）
  const metrics = buildWorkbenchStatusMetrics(items, 'person', 魏红义);
  const cardValue = (key: string) => metrics.find(m => m.key === key)!.value;

  // 下钻列表命中条数（与 Items/index.tsx ownerId=me 分支等价）
  const drillCount = (key: string) => items.filter(i => isUserWorkbenchItem(key as any, i, 魏红义)).length;

  // 核心：五个卡片首页数字与下钻列表条数必须完全一致（一一对应）
  for (const key of ['pendingOpen', 'overdue', 'noFeedback', 'incomplete', 'completed'] as const) {
    assert.equal(drillCount(key), cardValue(key), `【${key}】首页数字 ↔ 下钻条数 一一对应`);
  }

  // 具体值（基于真实口径：未反馈/未完成为事项级 hasFeedback，与本仓库既定定义一致）
  assert.equal(cardValue('pendingOpen'), 1, '待签收：仅事项a（魏红义本人未签）');
  assert.equal(cardValue('overdue'), 1, '已超期：仅事项d（魏红义子任务 OVERDUE）');
  assert.equal(cardValue('completed'), 1, '已完成：仅事项e（魏红义子任务 COMPLETED）');
  assert.equal(cardValue('incomplete'), 4, '未完成：a/b/c/d 魏红义子任务非 COMPLETED');
  assert.equal(cardValue('noFeedback'), 4, '未反馈：b/c/d/e 魏红义已签且无事项级反馈');
});

test('isUserWorkbenchItem：非责任人用户对所有事项均不命中', () => {
  const items = mixedItems();
  const 路人 = { id: 'user-lr', name: '路人甲', username: 'luren' };
  for (const key of ['pendingOpen', 'overdue', 'noFeedback', 'incomplete', 'completed'] as const) {
    assert.equal(items.filter(i => isUserWorkbenchItem(key, i, 路人)).length, 0, `路人 ${key} 全不命中`);
  }
});
