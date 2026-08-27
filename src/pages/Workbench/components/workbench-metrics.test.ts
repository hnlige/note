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

/**
 * 回归：同一事项给当前用户分配了【多个子任务】时，首页 person 数字必须与下钻条数一致。
 * 这正是贺诗然账号暴露的线上问题根因——修复前首页按「责任人任务数」累加（同一事项计多次），
 * 而下钻列表按「事项」计（一行一事项），导致首页数字 > 下钻条数。
 */
test('person+currentUser：同一事项多子任务，首页数字=下钻条数（贺诗然场景回归）', () => {
  const 贺诗然 = { id: 'user-he', name: '贺诗然', username: 'heshiran' };

  // 1 件事项：贺诗然被拆成 2 个子任务，均 OVERDUE 已签收无反馈；另 1 件贺诗然单子任务 COMPLETED。
  const items: SupervisionItem[] = [
    item({
      id: 'multi-subtask-same-user',
      status: 'OVERDUE',
      ownerName: '贺诗然',
      ownerNames: ['贺诗然'],
      ownerIds: ['user-he'],
      subTasks: [
        { ...subTask('贺诗然', 'OVERDUE'), assigneeId: 'user-he', id: 'sub-he-1' },
        { ...subTask('贺诗然', 'OVERDUE'), assigneeId: 'user-he', id: 'sub-he-2' },
      ],
      timeline: [
        { id: 'sh1', type: 'SIGN', user: '贺诗然', content: '签收', timestamp: '2026-07-01 09:00' },
        { id: 'sh2', type: 'SIGN', user: '贺诗然', content: '签收', timestamp: '2026-07-01 09:01' },
      ],
    }),
    item({
      id: 'single-completed',
      status: 'COMPLETED',
      ownerName: '贺诗然',
      ownerNames: ['贺诗然'],
      ownerIds: ['user-he'],
      subTasks: [{ ...subTask('贺诗然', 'COMPLETED'), assigneeId: 'user-he' }],
      timeline: [{ id: 'sc', type: 'SIGN', user: '贺诗然', content: '签收', timestamp: '2026-07-01 09:00' }],
    }),
  ];

  const metrics = buildWorkbenchStatusMetrics(items, 'person', 贺诗然);
  const cardValue = (key: string) => metrics.find(m => m.key === key)!.value;
  const drillCount = (key: string) => items.filter(i => isUserWorkbenchItem(key as any, i, 贺诗然)).length;

  // 核心断言：五个卡片首页数字与下钻列表条数必须完全一致（一件多子任务不再被灌高）。
  for (const key of ['pendingOpen', 'overdue', 'noFeedback', 'incomplete', 'completed'] as const) {
    assert.equal(cardValue(key), drillCount(key), `【${key}】首页数字 ↔ 下钻条数 一一对应（同一事项多子任务场景）`);
  }

  // 具体值：OVERDUE 事项只计 1 条（不是 2），COMPLETED 计 1 条；下钻同样为 1。
  assert.equal(cardValue('overdue'), 1, '同一事项 2 个 OVERDUE 子任务只计 1 条');
  assert.equal(cardValue('completed'), 1, '已完成 1 件');
  assert.equal(cardValue('incomplete'), 1, 'OVERDUE 事项未完成计入 1（COMPLETED 不计入）');
  assert.equal(cardValue('noFeedback'), 1, 'OVERDUE 已签无反馈计入 1（不是 2）');
  assert.equal(cardValue('pendingOpen'), 0, '已全部签收，待签收为 0');

  // 副标题「涉及 N 件督办」须与首页大字数字相等（修复前 overdue 会出现 2 vs 涉及 1 件 的错位）。
  const caption = (key: string) => metrics.find(m => m.key === key)!.caption;
  assert.equal(caption('overdue'), '涉及 1 件督办');
  assert.equal(caption('completed'), '涉及 1 件督办');
});

/* ----------------------------- 回归：截断时间轴导致未反馈计数 1↔0 波动（根因修复） ----------------------------- */

/**
 * 复现线上 刘维雷 账号问题：事项时间轴共 9 条，列表接口为控制体积只回传最近 5 条（slice(-5)）。
 * 刘维雷 的 2 条 FEEDBACK 节点落在被截断部分。修复前前端用被截断的时间轴重算，
 * 看不到他的反馈 → 误判为「未反馈」；修复后前端直接采用后端基于【完整时间轴】算出的 feedbackGiven 字段。
 */
test('person+currentUser：截断时间轴下按后端 feedbackGiven 判定，刘维雷本人未反馈稳定为 0（消除 1↔0 波动）', () => {
  const 刘维雷 = { id: 'user-liu', name: '刘维雷', username: '00000002' };
  // 模拟列表接口回传的「截断时间轴」：仅最近 5 条，已不含刘维雷的 FEEDBACK 节点。
  // 这正是线上波动的根因：前端若用截断时间轴重算，会看不到他的反馈 → 误判为未反馈（计 1）。
  const truncatedTimeline: TimelineNode[] = [
    { id: 't4', type: 'APPLY_COMPLETE', user: '刘维雷', content: '', timestamp: '2026-08-17 06:50:41' },
    { id: 't5', type: 'APPROVE', user: '贺诗然', content: '', timestamp: '2026-08-17 06:51:17' },
    { id: 't6', type: 'APPROVE', user: '吴艺悦', content: '', timestamp: '2026-08-17 06:51:51' },
    { id: 't7', type: 'SHARE', user: '姚玉玲', content: '', timestamp: '2026-08-17 06:54:50' },
    { id: 't8', type: 'SIGN', user: '刘维雷', content: '', timestamp: '2026-08-17 07:04:21' },
  ];
  // 后端基于【完整时间轴】算出并随列表下发的权威标记：刘维雷已签收且已反馈。
  const values = valuesByUser([
    item({
      id: 'cj-2026-006',
      status: 'OVERDUE',
      ownerName: '刘维雷',
      ownerNames: ['刘维雷', '贺诗然', '吴艺悦'],
      ownerIds: ['user-liu', 'user-he', 'user-wu'],
      lastFeedbackDate: '2026-08-16T16:00:00.000Z',
      subTasks: [
        { ...subTask('刘维雷', 'EXECUTING'), assigneeId: 'user-liu', signed: true, feedbackGiven: true },
        { ...subTask('贺诗然', 'EXECUTING'), assigneeId: 'user-he', signed: true, feedbackGiven: false },
        { ...subTask('吴艺悦', 'EXECUTING'), assigneeId: 'user-wu', signed: true, feedbackGiven: false },
      ],
      timeline: truncatedTimeline,
    }),
  ], 刘维雷);

  // 刘维雷 仅看自己的责任人任务：他本人已反馈 → 个人工作台「未反馈」稳定为 0，
  // 彻底消除修复前「截断时间轴下有时误判为 1」的 1↔0 波动。
  assert.equal(values.未反馈, 0, '刘维雷本人已反馈（后端 feedbackGiven=true）不被截断时间轴误判，个人未反馈稳定为 0');
  assert.equal(values.待签收, 0, '刘维雷本人已签收（后端 signed=true），不计待签收');
  assert.equal(values.未完成, 1, '刘维雷本人子任务 EXECUTING，计入未完成');
});

test('person：后端未下发 feedbackGiven 时回退到截断时间轴（兼容旧数据，复现修复前错误值）', () => {
  // 仅验证回退路径的「存在性」：缺省 feedbackGiven 时，person 模式统计所有责任人，
  // 截断时间轴下三人均无可见 FEEDBACK 节点 → 误判为 3（与修复前一致，仅作兼容说明）。
  // 新链路通过后端 feedbackGiven 字段规避该错误（见上方 刘维雷 修复测试）。
  const truncatedTimeline: TimelineNode[] = [
    { id: 't4', type: 'APPLY_COMPLETE', user: '刘维雷', content: '', timestamp: '2026-08-17 06:50:41' },
    { id: 't5', type: 'APPROVE', user: '贺诗然', content: '', timestamp: '2026-08-17 06:51:17' },
    { id: 't6', type: 'APPROVE', user: '吴艺悦', content: '', timestamp: '2026-08-17 06:51:51' },
    { id: 't7', type: 'SHARE', user: '姚玉玲', content: '', timestamp: '2026-08-17 06:54:50' },
    { id: 't8', type: 'SIGN', user: '刘维雷', content: '', timestamp: '2026-08-17 07:04:21' },
  ];
  const values = valuesByTitle([
    item({
      id: 'cj-2026-006-legacy',
      status: 'OVERDUE',
      ownerName: '刘维雷',
      ownerNames: ['刘维雷', '贺诗然', '吴艺悦'],
      ownerIds: ['user-liu', 'user-he', 'user-wu'],
      lastFeedbackDate: '2026-08-16T16:00:00.000Z',
      subTasks: [
        { ...subTask('刘维雷', 'EXECUTING'), assigneeId: 'user-liu' },
        { ...subTask('贺诗然', 'EXECUTING'), assigneeId: 'user-he' },
        { ...subTask('吴艺悦', 'EXECUTING'), assigneeId: 'user-wu' },
      ],
      timeline: truncatedTimeline,
    }),
  ]);

  // 回退路径：截断时间轴下三人均无可见 FEEDBACK 节点 → 误判为 3（与修复前一致，仅作兼容说明）
  assert.equal(values.未反馈, 3, '回退路径：截断时间轴下三人全被误判为未反馈（修复前行为）');
  assert.equal(values.待签收, 0, '三人均已进入执行态，回退路径不计待签收');
});
