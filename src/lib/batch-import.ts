import ExcelJS from 'exceljs';
import { DeptNode, OrgUser } from '../types';

// ─── 导入字段映射 ───
// CSV/Excel 表头 → 内部字段名
const HEADER_MAP: Record<string, string> = {
  '督办序号': 'serialNo',
  '督办事项': 'title',
  '责任部门': 'deptNames',
  '责任人': 'ownerName',
  '督办跟进人': 'followerName',
  '提出会议': 'meetingSource',
  '提出时间': 'raiseDate',
  '要求完成日期': 'requiredCompletionDate',
  '计划完成日期': 'plannedCompletionDate',
  '实际完成日期': 'actualCompletionDate',
};

// 必填字段（不含序号，序号在后端校验；责任部门可由责任人员工编号自动带出）
const REQUIRED_FIELDS = ['title', 'ownerName', 'followerName', 'meetingSource', 'raiseDate'];

export const IMPORT_TEMPLATE_HEADERS = [
  '督办序号',
  '督办事项',
  '责任人',
  '责任部门',
  '督办跟进人',
  '提出会议',
  '提出时间',
  '要求完成日期',
  '计划完成日期',
  '实际完成日期',
];

export function buildImportTemplateConfig() {
  return {
    filename: '督办事项导入模板.csv',
    headers: IMPORT_TEMPLATE_HEADERS,
    rows: [[
      'DB-2026-001',
      '请填写督办事项内容',
      'E001',
      '可留空，系统将按责任人员工编号自动带出',
      'F001',
      '2026年第4次办公会',
      '2026-07-30',
      '2026-08-30',
      '2026-08-25',
      '',
    ]],
  };
}

export interface ImportRow {
  rowIndex: number;   // Excel 行号（从 2 开始，第 1 行是表头）
  serialNo: string;
  title: string;
  deptNames: string;
  ownerName: string;
  followerName: string;
  meetingSource: string;
  raiseDate: string;
  requiredCompletionDate?: string;
  plannedCompletionDate?: string;
  actualCompletionDate?: string;
}

export interface ImportValidationError {
  row: number;
  field: string;
  message: string;
}

export interface ImportResult {
  rows: ImportRow[];
  errors: ImportValidationError[];
}

function worksheetToJson(worksheet: ExcelJS.Worksheet): Record<string, string>[] {
  const rows = worksheet.getSheetValues().slice(1) as Array<undefined | ExcelJS.CellValue[]>;
  const headerRow = rows[0];
  if (!headerRow) {
    return [];
  }

  const headers = headerRow
    .slice(1)
    .map((value) => stringifyCellValue(value).trim());

  return rows
    .slice(1)
    .map((row) => {
      const values = (row ?? []).slice(1);
      return headers.reduce<Record<string, string>>((record, header, index) => {
        if (!header) return record;
        record[header] = stringifyCellValue(values[index]).trim();
        return record;
      }, {});
    })
    .filter((record) => Object.values(record).some(Boolean));
}

function stringifyCellValue(value: ExcelJS.CellValue | undefined): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return formatDateOnly(value);
  }
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') {
      return value.text;
    }
    if ('result' in value && value.result != null) {
      return String(value.result);
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text).join('');
    }
  }
  return String(value);
}

function parseCsvText(text: string): Record<string, string>[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  return lines
    .slice(1)
    .map((line) => {
      const values = parseCsvLine(line);
      return headers.reduce<Record<string, string>>((record, header, index) => {
        if (!header) return record;
        record[header.trim()] = (values[index] ?? '').trim();
        return record;
      }, {});
    })
    .filter((record) => Object.values(record).some(Boolean));
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function isZipBasedXlsx(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 4));
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function isLegacyXls(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 8));
  return (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  );
}

function getImportFileExtension(file: File): string {
  return file.name.split('.').pop()?.toLowerCase() || '';
}

// ─── 解析 Excel/CSV 文件 ───
export async function parseImportFile(file: File): Promise<ImportResult> {
  const extension = getImportFileExtension(file);

  try {
    if (extension === 'csv') {
      const text = await file.text();
      const rows = parseCsvText(text);
      if (rows.length === 0) {
        throw new Error('文件中没有数据行');
      }
      return validateAndMapRows(rows);
    }

    if (extension !== 'xlsx') {
      throw new Error('当前仅支持 .xlsx 或 .csv 文件；如为 .xls，请先用 Excel/WPS 另存为 .xlsx 后再导入');
    }

    const buffer = await file.arrayBuffer();
    if (!buffer.byteLength) {
      throw new Error('无法读取文件内容');
    }

    if (isLegacyXls(buffer)) {
      throw new Error('检测到旧版 .xls 文件，当前仅支持 .xlsx；请先用 Excel/WPS 另存为 .xlsx 后再导入');
    }

    if (!isZipBasedXlsx(buffer)) {
      throw new Error('文件不是有效的 .xlsx 工作簿；请确认没有把 .xls、CSV 或网页文件直接改名为 .xlsx');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('文件中没有找到工作表');
    }

    const rows = worksheetToJson(worksheet);
    if (rows.length === 0) {
      throw new Error('文件中没有数据行');
    }

    return validateAndMapRows(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('central directory') || message.includes('zip file')) {
      throw new Error('文件不是有效的 .xlsx 工作簿；请使用 Excel/WPS 打开后另存为 .xlsx，或直接上传 .csv 文件');
    }
    throw err instanceof Error ? err : new Error('文件解析失败');
  }
}

// ─── 校验并映射行 ───
function validateAndMapRows(rawRows: Record<string, string>[]): ImportResult {
  // 动态解析表头
  const headerKeys = Object.keys(rawRows[0] || {});
  const fieldMapping = buildFieldMapping(headerKeys);

  const rows: ImportRow[] = [];
  const errors: ImportValidationError[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const rowIndex = i + 2; // Excel 行号（第 1 行表头）

    const mapped: Record<string, string> = {};
    for (const [header, value] of Object.entries(raw)) {
      const field = fieldMapping[header.trim()];
      if (field) {
        mapped[field] = String(value || '').trim();
      }
    }

    // 校验必填字段
    const rowErrors: ImportValidationError[] = [];
    for (const field of REQUIRED_FIELDS) {
      if (!mapped[field]) {
        const label = Object.entries(HEADER_MAP).find(([, f]) => f === field)?.[0] || field;
        rowErrors.push({ row: rowIndex, field, message: `第${rowIndex}行缺少「${label}」` });
      }
    }

    // 如果有关键必填字段缺失，跳过该行
    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    rows.push({
      rowIndex,
      serialNo: mapped.serialNo || '',
      title: mapped.title || '',
      deptNames: mapped.deptNames || '',
      ownerName: mapped.ownerName || '',
      followerName: mapped.followerName || '',
      meetingSource: mapped.meetingSource || '',
      raiseDate: mapped.raiseDate || '',
      requiredCompletionDate: mapped.requiredCompletionDate || undefined,
      plannedCompletionDate: mapped.plannedCompletionDate || undefined,
      actualCompletionDate: mapped.actualCompletionDate || undefined,
    });
  }

  return { rows, errors };
}

// ─── 构建字段映射 ───
function buildFieldMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const normalized = header.trim();
    const field = HEADER_MAP[normalized];
    if (field) {
      mapping[normalized] = field;
    }
  }
  return mapping;
}

// ─── 格式化日期 ───
export function normalizeDate(value?: string, fallback?: string): string | null {
  const raw = String(value || fallback || '').trim();
  if (!raw) return null;

  // 尝试解析 Excel 序列号日期
  const num = Number(raw);
  if (!isNaN(num) && num > 40000 && num < 80000) {
    // Excel 日期序列号
    const d = new Date((num - 25569) * 86400 * 1000);
    return formatDateOnly(d);
  }

  // 尝试解析常见日期格式
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    return formatDateOnly(d);
  }

  return null;
}

function formatDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── 将 ImportRow 转为后端需要的创建数据 ───
function splitMultiValue(value: string): string[] {
  return String(value || '')
    .split(/[、,，;；\n\r/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

type ImportPayloadContext = {
  orgUsers?: readonly OrgUser[];
  departments?: readonly DeptNode[];
};

function findDepartmentById(nodes: readonly DeptNode[] | undefined, deptId: string): DeptNode | null {
  if (!nodes) return null;
  for (const node of nodes) {
    if (node.id === deptId) return node;
    const found = findDepartmentById(node.children || [], deptId);
    if (found) return found;
  }
  return null;
}

function findUserByIdentity(users: readonly OrgUser[] | undefined, identity: string): OrgUser | null {
  const normalized = identity.trim().toLowerCase();
  if (!normalized) return null;
  return users?.find(user =>
    user.id.toLowerCase() === normalized ||
    user.username.toLowerCase() === normalized ||
    user.name.toLowerCase() === normalized
  ) || null;
}

function resolveUserIdentities(values: string[], context?: ImportPayloadContext) {
  return values.map(value => {
    const user = findUserByIdentity(context?.orgUsers, value);
    return {
      input: value,
      id: user?.id || value,
      name: user?.name || value,
      deptName: user?.deptId ? findDepartmentById(context?.departments, user.deptId)?.name : undefined,
    };
  });
}

export function rowToCreatePayload(row: ImportRow, context?: ImportPayloadContext) {
  const deptNames = splitMultiValue(row.deptNames);
  const ownerNames = splitMultiValue(row.ownerName);
  const resolvedOwners = resolveUserIdentities(ownerNames, context);
  const resolvedFollowers = resolveUserIdentities(splitMultiValue(row.followerName), context);
  const resolvedDeptNames = deptNames.length > 0
    ? deptNames
    : resolvedOwners.map(owner => owner.deptName).filter((name): name is string => Boolean(name));
  const primaryOwner = resolvedOwners[0];
  const primaryFollower = resolvedFollowers[0];

  return {
    serialNo: row.serialNo,
    title: row.title,
    content: row.title,
    deptNames: resolvedDeptNames,
    ownerName: primaryOwner?.name || row.ownerName,
    ownerId: primaryOwner?.id || row.ownerName,
    ownerNames: resolvedOwners.map(owner => owner.name),
    ownerIds: resolvedOwners.map(owner => owner.id),
    followerName: primaryFollower?.name || row.followerName,
    followerId: primaryFollower?.id || row.followerName,
    followerNames: resolvedFollowers.map(follower => follower.name),
    followerIds: resolvedFollowers.map(follower => follower.id),
    meetingSource: row.meetingSource,
    raiseDate: normalizeDate(row.raiseDate),
    requiredCompletionDate: normalizeDate(row.requiredCompletionDate) || normalizeDate(row.plannedCompletionDate) || undefined,
    plannedCompletionDate: normalizeDate(row.plannedCompletionDate) || undefined,
    actualCompletionDate: normalizeDate(row.actualCompletionDate) || undefined,
    category: '',
    campus: '',
    deadline: normalizeDate(row.requiredCompletionDate) || normalizeDate(row.plannedCompletionDate) || '',
    status: 'PENDING' as const,
  };
}
