import { CsvCell } from '../../lib/export-csv';
import { canAccessByAuthCodes, canUsePageAction } from '../../store/role-access';
import type { Role, User } from '../../types';

type LogExportRow = {
  timestamp?: unknown;
  userName?: unknown;
  module?: unknown;
  action?: unknown;
  ip?: unknown;
};

function safeCell(value: unknown): CsvCell {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

export function canExportLogs(user: Pick<User, 'roleId' | 'roleIds'>, roles: readonly Role[]): boolean {
  return canAccessByAuthCodes(user, roles, ['MENU_LOGS'])
    && canUsePageAction(user, roles, 'MENU_LOGS', 'EXPORT');
}

export function buildLogsExport(logs: readonly LogExportRow[]): { headers: string[]; rows: CsvCell[][] } {
  return {
    headers: ['时间', '用户', '模块', '操作', 'IP'],
    rows: logs.map((log) => [
      safeCell(log.timestamp),
      safeCell(log.userName),
      safeCell(log.module),
      safeCell(log.action),
      safeCell(log.ip),
    ]),
  };
}

export function matchesLogKeyword(log: LogExportRow, keyword: string): boolean {
  const query = keyword.trim().toLowerCase();
  if (!query) return true;
  return [log.userName, log.action, log.module, log.ip, log.timestamp]
    .some(value => String(value ?? '').toLowerCase().includes(query));
}
