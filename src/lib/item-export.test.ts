import test from 'node:test';
import assert from 'node:assert/strict';

import { buildItemExportConfig } from './item-export.ts';

test('buildItemExportConfig returns excel exports with all admin ledger fields', () => {
  const config = buildItemExportConfig({
    filenameBase: '督办事项全量导出',
    format: 'excel',
    fieldPreset: 'all',
    rows: [
      {
        serialNo: 'DB-2026-001',
        title: '测试事项',
        content: '测试内容',
        ownerName: '李承办',
        followerName: '吴艺悦',
        deadline: '2026-06-25',
        requiredCompletionDate: '2026-06-25',
        plannedCompletionDate: '2026-06-28',
        actualCompletionDate: '2026-06-30',
        raiseDate: '2026-06-19',
        meetingName: '周例会',
        statusLabel: '待签收',
        deptNames: ['董事会'],
      },
    ],
  });

  assert.equal(config.filename, '督办事项全量导出.xls');
  assert.deepEqual(config.headers, [
    '督办序号',
    '标题',
    '督办事项',
    '状态',
    '责任部门',
    '责任人',
    '跟进人',
    '提出会议',
    '提出时间',
    '要求完成日期',
    '计划完成日期',
    '实际完成日期',
  ]);
  assert.deepEqual(config.rows, [[
    'DB-2026-001',
    '测试事项',
    '测试内容',
    '待签收',
    '董事会',
    '李承办',
    '吴艺悦',
    '周例会',
    '2026-06-19',
    '2026-06-25',
    '2026-06-28',
    '2026-06-30',
  ]]);
});
