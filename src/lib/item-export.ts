export type ItemExportFormat = 'csv' | 'excel';
export type ItemExportFieldPreset = 'summary' | 'all';

type ExportRowInput = {
  serialNo: string;
  title: string;
  content?: string;
  statusLabel: string;
  deptNames?: string[];
  ownerName: string;
  followerName?: string;
  meetingName?: string;
  raiseDate?: string;
  deadline?: string;
  requiredCompletionDate?: string;
  plannedCompletionDate?: string;
  actualCompletionDate?: string;
};

type BuildItemExportConfigInput = {
  filenameBase: string;
  format: ItemExportFormat;
  fieldPreset: ItemExportFieldPreset;
  rows: ExportRowInput[];
};

export type ItemExportConfig = {
  filename: string;
  headers: string[];
  rows: string[][];
};

const SUMMARY_HEADERS = ['督办序号', '标题', '状态', '责任人', '跟进人', '截止日期'];
const ALL_HEADERS = ['督办序号', '标题', '督办事项', '状态', '责任部门', '责任人', '跟进人', '提出会议', '提出时间', '要求完成日期', '计划完成日期', '实际完成日期'];

export function buildItemExportConfig(input: BuildItemExportConfigInput): ItemExportConfig {
  const headers = input.fieldPreset === 'all' ? ALL_HEADERS : SUMMARY_HEADERS;
  const rows = input.rows.map((row) => {
    if (input.fieldPreset === 'all') {
      return [
        row.serialNo,
        row.title,
        row.content || '',
        row.statusLabel,
        (row.deptNames || []).join('、'),
        row.ownerName,
        row.followerName || '',
        row.meetingName || '',
        row.raiseDate || '',
        row.requiredCompletionDate || '',
        row.plannedCompletionDate || '',
        row.actualCompletionDate || '',
      ];
    }

    return [
      row.serialNo,
      row.title,
      row.statusLabel,
      row.ownerName,
      row.followerName || '',
      row.deadline || '',
    ];
  });

  return {
    filename: `${input.filenameBase}.${input.format === 'excel' ? 'xls' : 'csv'}`,
    headers,
    rows,
  };
}
