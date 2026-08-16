import { UrgeRecord } from '../../types';

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTimestampDateKey(timestamp?: string): string | null {
  if (!timestamp) return null;
  const value = String(timestamp).trim();
  const datePrefix = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (datePrefix) {
    return [
      datePrefix[1],
      datePrefix[2].padStart(2, '0'),
      datePrefix[3].padStart(2, '0'),
    ].join('-');
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return toLocalDateKey(parsed);
}

export function getTodayUrgeRecords(records: UrgeRecord[], now = new Date()): UrgeRecord[] {
  const today = toLocalDateKey(now);
  return records.filter(record => getTimestampDateKey(record.timestamp) === today);
}
