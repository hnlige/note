import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateWorkbenchTabs,
  formatValidationReport,
  WORKBENCH_TAB_SPECS,
  EnrichedItem,
} from './workbench-tab-validation';

/**
 * 合成督办事项构造器。仅填充校验逻辑实际读取的字段，其余以 any 兼容。
 */
function makeItem(over: Record<string, unknown>): EnrichedItem {
  const base: Record<string, unknown> = {
    id: over.id ?? 'x',
    title: over.title ?? '事项',
    status: over.status ?? 'PENDING',
    timeline: over.timeline ?? [],
    ownerName: over.ownerName,
    ownerNames: over.ownerNames ?? [],
    subTasks: over.subTasks ?? [],
    signOffStatus: over.signOffStatus,
    lastFeedbackDate: over.lastFeedbackDate,
  };
  return { ...base, ...over } as unknown as EnrichedItem;
}

const SIGN = (user: string) => ({ type: 'SIGN', user, content: '签收', timestamp: '2026-01-01 00:00:00' });
const FEEDBACK = (user: string) => ({ type: 'FEEDBACK', user, content: '反馈', timestamp: '2026-01-02 00:00:00' });

/**
 * 场景设计（均不含已删除项，覆盖五类标签与真实/展示分歧；事项维度，每件最多计 1）：
 *  A 未签收·单责·无签收节点        → 待签收(real+display) / 非未反馈
 *  B 已签·单责·无反馈(执行中)      → 未反馈(real+display)
 *  C 已签·单责·有反馈(执行中)      → 非未反馈
 *  D 多责·仅一人签·部分签收·无反馈(执行中) → 待签收(D 部分签收)；非未反馈(D 未全签)
 *  E 多责·全签·无反馈(执行中)      → 未反馈(real+display)
 *  F 已办结·有反馈                → 已完成(real+display)
 *  G 已超时·多责仅一人签·部分签收·无反馈    → 已超期(real+display)；当前状态为已超时非执行中，不计入未反馈
 *  H 已延期·已签·无反馈           → 已超期(real+display)；未反馈(real+display)
 *  I 已删除                       → 不计入任何标签
 */
const fixtures: EnrichedItem[] = [
  makeItem({ id: 'A', title: 'A未签收单责', status: 'PENDING', ownerNames: ['张三'], timeline: [] }),
  makeItem({ id: 'B', title: 'B已签单责无反馈', status: 'PENDING', ownerNames: ['张三'], timeline: [SIGN('张三')] }),
  makeItem({ id: 'C', title: 'C已签单责有反馈', status: 'PENDING', ownerNames: ['张三'], timeline: [SIGN('张三'), FEEDBACK('张三')] }),
  makeItem({ id: 'D', title: 'D多责未全签', status: 'PENDING', ownerNames: ['张三', '李四'], timeline: [SIGN('张三')] }),
  makeItem({ id: 'E', title: 'E多责全签无反馈', status: 'PENDING', ownerNames: ['张三', '李四'], timeline: [SIGN('张三'), SIGN('李四')] }),
  makeItem({ id: 'F', title: 'F已办结', status: 'COMPLETED', ownerNames: ['张三'], timeline: [SIGN('张三'), FEEDBACK('张三')] }),
  makeItem({ id: 'G', title: 'G已超时未全签', status: 'OVERDUE', ownerNames: ['张三', '李四'], timeline: [SIGN('张三')] }),
  makeItem({ id: 'H', title: 'H已延期已签', status: 'DELAYED', ownerNames: ['张三'], timeline: [SIGN('张三')] }),
  makeItem({ id: 'I', title: 'I已删除', status: 'DELETED', ownerNames: ['张三'], timeline: [] }),
];

function tab(report: ReturnType<typeof validateWorkbenchTabs>, key: string) {
  const t = report.tabs.find(x => x.key === key);
  if (!t) throw new Error(`tab ${key} not found`);
  return t;
}

describe('工作台状态标签校验', () => {
  test('已超期 / 已完成 口径一致', () => {
    const report = validateWorkbenchTabs(fixtures);
    const overdue = tab(report, 'overdue');
    // BL-04 后，历史 OVERDUE 事项一旦存在责任人签收/反馈，即由后端权威状态收敛为 EXECUTING；
    // G 已有 SIGN，仅 H（DELAYED）仍属于已超期。
    assert.equal(overdue.realCount, 1, '已超期真实应为 H；G 签收后已恢复执行中');
    assert.equal(overdue.displayedCount, 1);
    assert.equal(overdue.matched, true);

    const completed = tab(report, 'completed');
    assert.equal(completed.realCount, 1, '已完成真实应为 F');
    assert.equal(completed.displayedCount, 1);
    assert.equal(completed.matched, true);
  });

  test('待签收 与 工作台待签收卡片口径一致（事项维度）', () => {
    const report = validateWorkbenchTabs(fixtures);
    const pendingOpen = tab(report, 'pendingOpen');
    assert.equal(pendingOpen.realCount, 3, '事项维度：A 未签收 + D/G 部分签收（signOff≠SIGNED）均计入；B/E/H 均已签收不计');
    assert.equal(pendingOpen.displayedCount, 3, '工作台待签收卡片同口径（signOffStatus !== SIGNED），计 A、D、G');
    assert.equal(pendingOpen.matched, true);
    assert.deepEqual(pendingOpen.onlyInReal.map(r => r.id), []);
    assert.equal(pendingOpen.onlyInDisplayed.length, 0);
  });

  test('未反馈 口径一致：已签收(SIGNED)且无反馈的事项（事项维度，不含未签收）', () => {
    const report = validateWorkbenchTabs(fixtures);
    const noFeedback = tab(report, 'noFeedback');
    assert.equal(noFeedback.realCount, 3, '事项维度：B、E、H 已签收且无反馈计入；C 有反馈、D/G 未全签、F 已办结不计');
    assert.equal(noFeedback.displayedCount, 3, '工作台未反馈卡片与规范口径一致（signOffStatus===SIGNED && !hasFeedback）');
    assert.equal(noFeedback.matched, true);
    assert.deepEqual(noFeedback.onlyInReal.map(r => r.id), []);
    assert.equal(noFeedback.onlyInDisplayed.length, 0);
  });

  test('未完成 已实现为工作台卡片(ui-card)，口径与规范一致', () => {
    const report = validateWorkbenchTabs(fixtures);
    const incomplete = tab(report, 'incomplete');
    assert.equal(incomplete.realCount, 7, '未完成真实应为 8 有效项 − 1 已完成(F)');
    assert.equal(incomplete.displayedCount, 7, '工作台未完成卡片与规范口径一致');
    assert.equal(incomplete.matched, true);
    assert.equal(incomplete.displayedSource, 'ui-card');
  });

  test('已删除项不参与任何标签统计', () => {
    const report = validateWorkbenchTabs(fixtures);
    assert.equal(report.totalItems, 9);
    assert.equal(report.activeItems, 8);
    // I 不应出现在任何差异明细
    for (const t of report.tabs) {
      assert.ok(!t.onlyInReal.some(r => r.id === 'I'));
      assert.ok(!t.onlyInDisplayed.some(r => r.id === 'I'));
    }
  });

  test('汇总统计正确', () => {
    const report = validateWorkbenchTabs(fixtures);
    assert.equal(report.summary.matchedTabs, 5);
    assert.equal(report.summary.mismatchedTabs, 0);
    assert.equal(report.summary.notComparableTabs, 0);
    assert.equal(report.summary.totalMismatchItems, 0);
  });

  test('可读报告包含一致标记与不可比对标记（当前展示与需求口径一致，无不一致项）', () => {
    const report = validateWorkbenchTabs(fixtures);
    const text = formatValidationReport(report);
    assert.match(text, /✅ 一致/);
    assert.match(text, /不可比对/);
    assert.doesNotMatch(text, /❌ 不一致/);
  });

  test('SPEC 覆盖五个标签且口径声明完整', () => {
    const keys = WORKBENCH_TAB_SPECS.map(s => s.key);
    assert.deepEqual(keys, ['pendingOpen', 'overdue', 'noFeedback', 'incomplete', 'completed']);
    for (const s of WORKBENCH_TAB_SPECS) {
      assert.ok(s.description.length > 0);
      assert.ok(typeof s.predicate === 'function');
    }
  });
});
