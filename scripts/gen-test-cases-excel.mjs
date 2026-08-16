import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mdPath = resolve(__dirname, '../docs/test-cases-2026-08-15.md');
const outPath = resolve(__dirname, '../docs/test-cases-2026-08-15.xlsx');

const md = readFileSync(mdPath, 'utf-8');

// ---- 解析测试用例 ----
const cases = [];
// 按 ### 分割
const blocks = md.split(/\n(?=###\s)/);

for (const block of blocks) {
  const headerMatch = block.match(/^###\s+([\w-]+)\s+`\[(核心|边界|异常)\]`\s+(.+)/);
  if (!headerMatch) continue;

  const id = headerMatch[1];
  const level = headerMatch[2];
  const title = headerMatch[3].trim();

  const get = (label) => {
    const re = new RegExp(`-\\s+\\*\\*${label}\\*\\*：([\\s\\S]*?)(?=\\n-\\s+\\*\\*|$)`);
    const m = block.match(re);
    if (!m) return '';
    return m[1].trim().replace(/\n\s*/g, '\n');
  };

  cases.push({
    id,
    level,
    title,
    purpose:       get('测试目的'),
    code:          get('对应代码'),
    precondition:  get('前置条件'),
    input:         get('输入数据'),
    steps:         get('操作步骤'),
    expected:      get('预期结果'),
    actual:        get('实际结果'),
  });
}

console.log(`解析到 ${cases.length} 条用例`);

// ---- 模块映射 ----
const MODULE_MAP = {
  WB: '工作台五态指标',
  SO: '签收状态聚合',
  EF: '事项有效状态计算',
  IT: '事项CRUD与状态流转',
  UR: '催办',
  LG: '亮灯',
  AE: '自动引擎',
  PE: '权限与数据范围',
  RL: '角色与内置角色刷新',
  MS: '消息可见性',
  AU: '认证与全局错误处理',
  VA: '输入校验',
  AP: '审批审核与审计',
  OR: '组织与账号',
  CF: '模板字典与全局规则',
  OP: '异步任务日志与导入导出',
};

const getModule = (id) => {
  const prefix = id.replace(/-?\d+$/, '');
  return MODULE_MAP[prefix] || prefix;
};

// ---- 构建 Excel ----
const wb = new ExcelJS.Workbook();
wb.creator = 'duban test-gen';
wb.created = new Date();

// ---------- 汇总 Sheet ----------
const summary = wb.addWorksheet('汇总', { views: [{ state: 'frozen', ySplit: 1 }] });
summary.columns = [
  { header: '用例编号', key: 'id',    width: 14 },
  { header: '模块',     key: 'mod',   width: 18 },
  { header: '级别',     key: 'level', width: 8  },
  { header: '测试目的', key: 'title', width: 40 },
  { header: '实际结果', key: 'actual',width: 20 },
];

const headerRow = summary.getRow(1);
headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
headerRow.height = 20;

const levelColor = { 核心: 'FF16A34A', 边界: 'FFD97706', 异常: 'FFDC2626' };

for (const c of cases) {
  const row = summary.addRow({
    id:     c.id,
    mod:    getModule(c.id),
    level:  `[${c.level}]`,
    title:  c.title,
    actual: c.actual || '⬜',
  });
  const lc = levelColor[c.level] || 'FF374151';
  row.getCell('level').font = { color: { argb: lc }, bold: true };
  row.getCell('actual').font = { color: { argb: c.actual && c.actual !== '⬜' ? 'FF16A34A' : 'FF9CA3AF' } };
  row.alignment = { wrapText: true, vertical: 'top' };
}

// 斑马纹
summary.eachRow((row, i) => {
  if (i === 1) return;
  const fill = i % 2 === 0
    ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
    : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
  row.eachCell((cell) => { cell.fill = fill; });
});

// ---------- 详情 Sheet ----------
const detail = wb.addWorksheet('详情', { views: [{ state: 'frozen', ySplit: 1 }] });
detail.columns = [
  { header: '用例编号', key: 'id',          width: 14 },
  { header: '模块',     key: 'mod',         width: 18 },
  { header: '级别',     key: 'level',       width: 8  },
  { header: '测试目的', key: 'title',       width: 30 },
  { header: '测试目的（详）', key: 'purpose', width: 40 },
  { header: '对应代码', key: 'code',        width: 36 },
  { header: '前置条件', key: 'precondition',width: 36 },
  { header: '输入数据', key: 'input',       width: 36 },
  { header: '操作步骤', key: 'steps',       width: 36 },
  { header: '预期结果', key: 'expected',    width: 40 },
  { header: '实际结果', key: 'actual',      width: 20 },
];

const dHeaderRow = detail.getRow(1);
dHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
dHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
dHeaderRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
dHeaderRow.height = 20;

for (const c of cases) {
  const row = detail.addRow({
    id:          c.id,
    mod:         getModule(c.id),
    level:       `[${c.level}]`,
    title:       c.title,
    purpose:     c.purpose,
    code:        c.code,
    precondition:c.precondition,
    input:       c.input,
    steps:       c.steps,
    expected:    c.expected,
    actual:      c.actual || '⬜',
  });
  row.alignment = { wrapText: true, vertical: 'top' };
  const lc = levelColor[c.level] || 'FF374151';
  row.getCell('level').font = { color: { argb: lc }, bold: true };
}

detail.eachRow((row, i) => {
  if (i === 1) return;
  const fill = i % 2 === 0
    ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FF' } }
    : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
  row.eachCell((cell) => { cell.fill = fill; });
});

// ---------- 按模块分 Sheet ----------
const modules = [...new Set(cases.map(c => getModule(c.id)))];
for (const mod of modules) {
  const modCases = cases.filter(c => getModule(c.id) === mod);
  const ws = wb.addWorksheet(mod.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: '用例编号', key: 'id',          width: 14 },
    { header: '级别',     key: 'level',       width: 8  },
    { header: '测试目的', key: 'title',       width: 34 },
    { header: '前置条件', key: 'precondition',width: 34 },
    { header: '输入数据', key: 'input',       width: 34 },
    { header: '操作步骤', key: 'steps',       width: 34 },
    { header: '预期结果', key: 'expected',    width: 40 },
    { header: '实际结果', key: 'actual',      width: 20 },
  ];
  const h = ws.getRow(1);
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  h.alignment = { vertical: 'middle', horizontal: 'center' };
  h.height = 20;

  for (const c of modCases) {
    const row = ws.addRow({
      id:          c.id,
      level:       `[${c.level}]`,
      title:       c.title,
      precondition:c.precondition,
      input:       c.input,
      steps:       c.steps,
      expected:    c.expected,
      actual:      c.actual || '⬜',
    });
    row.alignment = { wrapText: true, vertical: 'top' };
    const lc = levelColor[c.level] || 'FF374151';
    row.getCell('level').font = { color: { argb: lc }, bold: true };
  }
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const fill = i % 2 === 0
      ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDFA' } }
      : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    row.eachCell((cell) => { cell.fill = fill; });
  });
}

await wb.xlsx.writeFile(outPath);
console.log(`✅ 已生成：${outPath}`);
