import type { AsyncTask } from '../types';

/** 服务端 async_tasks 表记录（GET /api/async-tasks 返回，时间为 ISO 字符串） */
export interface ServerAsyncTaskRecord {
  id: string;
  name: string;
  module?: string | null;
  status?: string | null;
  progress?: number | null;
  result?: string | null;
  startTime: string;
  endTime?: string | null;
}

const TASK_STATUSES: AsyncTask['status'][] = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'];

/** ISO/Date 字符串 → 'YYYY-MM-DD HH:mm'；非法输入原样返回，避免监控页空白 */
export function formatTaskTime(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function mapServerAsyncTask(record: ServerAsyncTaskRecord): AsyncTask {
  const status = TASK_STATUSES.includes(record.status as AsyncTask['status'])
    ? (record.status as AsyncTask['status'])
    : 'PENDING';
  const startTime = formatTaskTime(record.startTime);
  return {
    id: record.id,
    name: record.name,
    module: record.module || undefined,
    status,
    progress: typeof record.progress === 'number' ? record.progress : 0,
    result: record.result || undefined,
    startTime,
    endTime: formatTaskTime(record.endTime) || undefined,
    type: 'EXPORT',
  };
}

/** 按开始时间倒序（最新任务在前），供监控页展示 */
export function sortTasksNewestFirst(tasks: AsyncTask[]): AsyncTask[] {
  return [...tasks].sort((a, b) => b.startTime.localeCompare(a.startTime));
}
