export type CsvCell = string | number | boolean | null | undefined;

function neutralizeSpreadsheetFormula(value: string): string {
  return /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
}

function escapeCsvCell(cell: CsvCell): string {
  const rawValue = cell === null || cell === undefined ? '' : String(cell);
  const value = typeof cell === 'string' ? neutralizeSpreadsheetFormula(rawValue) : rawValue;
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildCsvContent(header: string[], rows: CsvCell[][]): string {
  return [
    header.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ].join('\n');
}

export function downloadCsv(filename: string, header: string[], rows: CsvCell[][]): void {
  const csv = buildCsvContent(header, rows);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtmlCell(cell: CsvCell): string {
  const rawValue = cell === null || cell === undefined ? '' : String(cell);
  const value = typeof cell === 'string' ? neutralizeSpreadsheetFormula(rawValue) : rawValue;
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildExcelHtml(header: string[], rows: CsvCell[][]): string {
  const table = `
    <table>
      <thead>
        <tr>${header.map((cell) => `<th>${escapeHtmlCell(cell)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtmlCell(cell)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
  `;
  return `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8" /></head>
      <body>${table}</body>
    </html>
  `;
}

export function downloadExcel(filename: string, header: string[], rows: CsvCell[][]): void {
  const html = buildExcelHtml(header, rows);
  const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
