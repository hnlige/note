import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWorkbenchOwnerFlags } from './workbench-flags';

test('computeWorkbenchOwnerFlags：截断时间轴外仍有反馈 → feedbackGiven=true（修复根因）', () => {
  // 复现线上 刘维雷 场景：完整时间轴 9 条，FEEDBACK 节点落在「最近 5 条」之外。
  const fullTimeline = [
    { id: '1', type: 'CREATE', user: '姚玉玲' },
    { id: '2', type: 'SIGN', user: '刘维雷' },
    { id: '3', type: 'FEEDBACK', user: '刘维雷' },
    { id: '4', type: 'APPLY_COMPLETE', user: '刘维雷' },
    { id: '5', type: 'APPROVE', user: '贺诗然' },
    { id: '6', type: 'APPROVE', user: '吴艺悦' },
    { id: '7', type: 'SHARE', user: '姚玉玲' },
    { id: '8', type: 'SIGN', user: '刘维雷' },
    { id: '9', type: 'URGE', user: '王跟进' },
  ];
  const item = {
    lastFeedbackDate: null,
    subTasks: [
      { id: 's1', assigneeName: '刘维雷', status: 'EXECUTING' },
      { id: 's2', assigneeName: '贺诗然', status: 'EXECUTING' },
      { id: 's3', assigneeName: '吴艺悦', status: 'EXECUTING' },
    ],
  };
  const { subTasks, hasFeedback } = computeWorkbenchOwnerFlags(item as any, fullTimeline as any);
  const liu = subTasks.find((s: any) => s.assigneeName === '刘维雷');
  assert.equal(liu.feedbackGiven, true, '刘维雷的反馈虽在被截断部分，仍应判为已反馈');
  assert.equal(liu.signed, true);
  // 完整时间轴含 FEEDBACK 节点 → 事项级 hasFeedback=true
  assert.equal(hasFeedback, true);
});

test('computeWorkbenchOwnerFlags：无反馈节点且 lastFeedbackDate 为空 → hasFeedback=false', () => {
  const fullTimeline = [
    { id: '1', type: 'CREATE', user: '姚' },
    { id: '2', type: 'SIGN', user: '刘维雷' },
  ];
  const item = { lastFeedbackDate: null, subTasks: [{ id: 's1', assigneeName: '刘维雷', status: 'EXECUTING' }] };
  const { subTasks, hasFeedback } = computeWorkbenchOwnerFlags(item as any, fullTimeline as any);
  assert.equal(subTasks[0].feedbackGiven, false);
  assert.equal(hasFeedback, false);
});

test('computeWorkbenchOwnerFlags：FOLLOWER_FEEDBACK 计入事项级 hasFeedback', () => {
  const fullTimeline = [
    { id: '1', type: 'CREATE', user: '姚' },
    { id: '2', type: 'FOLLOWER_FEEDBACK', user: '跟进人' },
  ];
  const item = { lastFeedbackDate: null, subTasks: [] };
  const { hasFeedback } = computeWorkbenchOwnerFlags(item as any, fullTimeline as any);
  assert.equal(hasFeedback, true);
});

test('computeWorkbenchOwnerFlags：DELETED 子任务被排除，signed 不误判', () => {
  const fullTimeline = [{ id: '1', type: 'SIGN', user: '刘维雷' }];
  const item = {
    lastFeedbackDate: null,
    subTasks: [
      { id: 's1', assigneeName: '刘维雷', status: 'DELETED' },
      { id: 's2', assigneeName: '贺诗然', status: 'EXECUTING' },
    ],
  };
  const { subTasks } = computeWorkbenchOwnerFlags(item as any, fullTimeline as any);
  // s1 为 DELETED，前端会先过滤掉；此处验证 flag 计算与前端过滤口径一致（DELETED 视为未签收）
  assert.equal(subTasks[0].signed, false);
  assert.equal(subTasks[1].signed, false, '没有 SIGN 且没有计划完成日期的子任务不能被反馈自动标记为已签收');
});
