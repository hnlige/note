import test from 'node:test';
import assert from 'node:assert/strict';

test('CSV export neutralizes spreadsheet formulas while preserving CSV escaping and scalar values', async () => {
  const csvModule = await import('./export-csv');
  const buildCsvContent = (csvModule as typeof csvModule & {
    buildCsvContent?: (header: string[], rows: Array<Array<string | number | boolean | null>>) => string;
  }).buildCsvContent;

  assert.equal(typeof buildCsvContent, 'function');
  assert.equal(buildCsvContent?.(
    ['名称', '=危险'],
    [[
      '=1+1', '+SUM(A1:A2)', '-2+3', '@cmd', '\tformula', '\rformula',
      '逗号,引号"换行\n值', '2026-08-08', -42, 3.14, true, null,
    ]],
  ), "名称,'=危险\n'=1+1,'+SUM(A1:A2),'-2+3,'@cmd,'\tformula,\"'\rformula\",\"逗号,引号\"\"换行\n值\",2026-08-08,-42,3.14,true,");
});

test('Excel HTML export neutralizes spreadsheet formulas before HTML escaping', async () => {
  const excelModule = await import('./export-csv');
  const buildExcelHtml = (excelModule as typeof excelModule & {
    buildExcelHtml?: (header: string[], rows: Array<Array<string | number | boolean | null>>) => string;
  }).buildExcelHtml;

  assert.equal(typeof buildExcelHtml, 'function');
  const html = buildExcelHtml?.(
    ['=标题', '普通'],
    [['+SUM(A1:A2)', '-2+3', '@cmd', '\tformula', '\rformula', '<script>', -42, true, null]],
  ) || '';

  assert.match(html, /<th>'=标题<\/th>/);
  assert.match(html, /<td>'\+SUM\(A1:A2\)<\/td>/);
  assert.match(html, /<td>'-2\+3<\/td>/);
  assert.match(html, /<td>'@cmd<\/td>/);
  assert.match(html, /<td>'\tformula<\/td>/);
  assert.match(html, /<td>'\rformula<\/td>/);
  assert.match(html, /<td>&lt;script&gt;<\/td>/);
  assert.match(html, /<td>-42<\/td>/);
  assert.match(html, /<td>true<\/td>/);
  assert.match(html, /<td><\/td>/);
});
