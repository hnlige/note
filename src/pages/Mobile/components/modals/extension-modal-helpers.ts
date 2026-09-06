import {
  isValidManualDateInput,
  normalizeManualDateInput,
  todayDateString,
} from '../../../../lib/item-format';

function isCalendarDate(value: string): boolean {
  if (!isValidManualDateInput(value)) return false;
  const [year, month, day] = value.split('/').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function toDateInputValue(value?: string): string {
  if (!value) return '';
  const datePart = value.trim().split(/[T ]/, 1)[0];
  const normalized = normalizeManualDateInput(datePart);
  return isCalendarDate(normalized) ? normalized.replace(/\//g, '-') : '';
}

export function toManualDateValue(value: string): string {
  const normalized = normalizeManualDateInput(value.replace(/-/g, '/'));
  return isCalendarDate(normalized) ? normalized : '';
}

export function isExtensionDateAllowed(value: string, today = todayDateString()): boolean {
  const normalizedValue = toManualDateValue(value);
  const normalizedToday = toManualDateValue(today);
  return isCalendarDate(normalizedValue)
    && isCalendarDate(normalizedToday)
    && normalizedValue > normalizedToday;
}

export function isExtensionReasonValid(value: string): boolean {
  const length = value.trim().length;
  return length >= 5 && value.length <= 500;
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function getWheelYears(today = new Date(), yearsAhead = 10): number[] {
  const start = today.getFullYear();
  return Array.from({ length: yearsAhead + 1 }, (_, index) => start + index);
}

export function getWheelMonths(): number[] {
  return Array.from({ length: 12 }, (_, index) => index + 1);
}

export function getWheelDays(year: number, month: number): number[] {
  return Array.from({ length: getDaysInMonth(year, month) }, (_, index) => index + 1);
}

export function formatWheelDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getTomorrowDate(today = new Date()): string {
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  return formatWheelDate(tomorrow.getFullYear(), tomorrow.getMonth() + 1, tomorrow.getDate());
}
