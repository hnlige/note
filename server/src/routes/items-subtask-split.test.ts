import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutoSubTasks, buildOwnerPairs } from './items';

const stubUuid = (() => {
  let n = 0;
  return () => `uuid-${++n}`;
})();

test('buildOwnerPairs 去重并支持仅姓名配对', () => {
  const withIds = buildOwnerPairs(['u1', 'u1', 'u2'], ['张三', '张三', '李四']);
  assert.equal(withIds.length, 2);
  assert.deepEqual(withIds, [
    { id: 'u1', name: '张三' },
    { id: 'u2', name: '李四' },
  ]);

  const nameOnly = buildOwnerPairs([], ['王五', '赵六']);
  assert.equal(nameOnly.length, 2);
  assert.deepEqual(nameOnly, [
    { id: '', name: '王五' },
    { id: '', name: '赵六' },
  ]);
});

test('单责任人不拆分（返回空数组）', () => {
  const pairs = buildOwnerPairs(['u1'], ['张三']);
  const subTasks = buildAutoSubTasks('item-1', pairs, { title: 'T', requiredCompletionDate: '2026-09-01' }, stubUuid);
  assert.equal(subTasks.length, 0);
});

test('多责任人自动拆分：每位责任人一条独立子任务，含三类日期', () => {
  const pairs = buildOwnerPairs(['u1', 'u2', 'u3'], ['张三', '李四', '王五']);
  const subTasks = buildAutoSubTasks(
    'item-9',
    pairs,
    { title: '督办A', requiredCompletionDate: '2026-09-01', plannedCompletionDate: '' },
    stubUuid,
  );

  assert.equal(subTasks.length, 3);
  // 每个子任务绑定独立责任人
  assert.deepEqual(
    subTasks.map((t: any) => t.assigneeName).sort(),
    ['张三', '李四', '王五'],
  );
  // 要求完成日期全事项通用，计划完成日期缺省回退到要求完成日期
  for (const t of subTasks) {
    assert.equal(t.parentItemId, 'item-9');
    assert.equal(t.requiredCompletionDate, '2026-09-01');
    assert.equal(t.plannedCompletionDate, '2026-09-01');
    assert.equal(t.status, 'PENDING');
    assert.equal(t.actualCompletionDate, '');
    assert.ok(t.id.startsWith('uuid-'));
  }
});

test('多责任人拆分时计划完成日期优先使用各自填写值', () => {
  const pairs = buildOwnerPairs(['u1', 'u2'], ['张三', '李四']);
  const subTasks = buildAutoSubTasks(
    'item-2',
    pairs,
    { title: '督办B', requiredCompletionDate: '2026-10-01', plannedCompletionDate: '2026-09-15' },
    stubUuid,
  );
  assert.equal(subTasks.length, 2);
  for (const t of subTasks) {
    assert.equal(t.plannedCompletionDate, '2026-09-15');
    assert.equal(t.requiredCompletionDate, '2026-10-01');
  }
});
