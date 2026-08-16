import test from 'node:test';
import assert from 'node:assert/strict';

import {
  paginateTimelineNodes,
  prepareTimelineNodes,
  TIMELINE_PAGE_SIZE_OPTIONS,
} from './detail-timeline-pagination.ts';
import type { TimelineNode } from '../../types/index.ts';

const build = (id: string, overrides: Partial<TimelineNode> = {}): TimelineNode => ({
  id,
  type: 'FEEDBACK',
  user: '张三',
  content: `内容-${id}`,
  timestamp: '2026-08-10T00:00:00.000Z',
  ...overrides,
});

test('prepareTimelineNodes 按时间倒序（新在前）并去重', () => {
  const nodes: TimelineNode[] = [
    build('a', { timestamp: '2026-08-10T09:00:00.000Z' }),
    build('a', { timestamp: '2026-08-10T09:00:00.000Z' }),
    build('b', { timestamp: '2026-08-12T09:00:00.000Z' }),
    build('c', { timestamp: '2026-08-11T09:00:00.000Z' }),
  ];

  const result = prepareTimelineNodes(nodes, null);

  assert.deepEqual(result.map(n => n.id), ['b', 'c', 'a']);
});

test('prepareTimelineNodes 按选中责任人过滤：匹配 user 或内容中的「责任人」标记', () => {
  const nodes: TimelineNode[] = [
    build('a', { user: '张三', timestamp: '2026-08-10T09:00:00.000Z' }),
    build('b', { user: '李四', timestamp: '2026-08-11T09:00:00.000Z' }),
    build('c', { user: '王五', content: '催办了「张三」负责的子任务', timestamp: '2026-08-09T09:00:00.000Z' }),
  ];

  const result = prepareTimelineNodes(nodes, '张三');

  assert.deepEqual(result.map(n => n.id), ['a', 'c']);
});

test('prepareTimelineNodes 无时间戳或非法时间戳的节点不抛错，按 0 处理排在最后', () => {
  const nodes: TimelineNode[] = [
    build('a', { timestamp: undefined as unknown as string }),
    build('b', { timestamp: '2026-08-12T09:00:00.000Z' }),
    build('c', { timestamp: 'not-a-date' }),
  ];

  const result = prepareTimelineNodes(nodes, null);

  assert.equal(result[0].id, 'b');
  assert.equal(result.length, 3);
});

test('paginateTimelineNodes 复用通用分页并按 pageSize 切片', () => {
  const nodes = Array.from({ length: 25 }, (_, index) =>
    build(String(index + 1), { timestamp: `2026-08-10T${String(index).padStart(2, '0')}:00:00.000Z` }),
  );

  const result = paginateTimelineNodes(nodes, 2, 10);

  assert.equal(result.totalPages, 3);
  assert.equal(result.currentPage, 2);
  assert.equal(result.rows.length, 10);
  assert.equal(result.rows[0].id, nodes[10].id);
});

test('TIMELINE_PAGE_SIZE_OPTIONS 与全局默认保持一致', () => {
  assert.deepEqual([...TIMELINE_PAGE_SIZE_OPTIONS], [10, 20, 50]);
});
