import React, { useEffect, useMemo, useRef } from 'react';
import {
  formatWheelDate,
  getDaysInMonth,
  getTomorrowDate,
  getWheelDays,
  getWheelMonths,
  getWheelYears,
} from './extension-modal-helpers';

interface MobileDateWheelPickerProps {
  value: string;
  onChange: (value: string) => void;
  minDate?: string;
}

const ITEM_HEIGHT = 42;
const VISIBLE_ITEMS = 5;
const WHEEL_PADDING = Math.floor(VISIBLE_ITEMS / 2);

function parseDate(value: string, fallback: string): [number, number, number] {
  const source = value.match(/^(\d{4})-(\d{2})-(\d{2})$/) ? value : fallback;
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

const WheelColumn: React.FC<{
  label: string;
  values: number[];
  selected: number;
  onSelect: (value: number) => void;
  format: (value: number) => string;
}> = ({ label, values, selected, onSelect, format }) => {
  const ref = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const selectedIndex = Math.max(0, values.indexOf(selected));

  useEffect(() => {
    ref.current?.scrollTo({ top: selectedIndex * ITEM_HEIGHT, behavior: 'auto' });
    initialized.current = true;
  }, [selectedIndex]);

  const handleScroll = () => {
    if (!initialized.current || !ref.current) return;
    const index = Math.max(0, Math.min(values.length - 1, Math.round(ref.current.scrollTop / ITEM_HEIGHT)));
    if (values[index] !== selected) onSelect(values[index]);
  };

  return (
    <div className="flex-1 min-w-0">
      <div className="text-center text-[10px] text-slate-400 font-bold mb-1">{label}</div>
      <div
        ref={ref}
        role="listbox"
        aria-label={label}
        tabIndex={0}
        onScroll={handleScroll}
        className="relative h-[210px] overflow-y-auto snap-y snap-mandatory rounded-xl bg-slate-50 scrollbar-none"
        style={{ scrollPaddingTop: WHEEL_PADDING * ITEM_HEIGHT, scrollPaddingBottom: WHEEL_PADDING * ITEM_HEIGHT }}
      >
        <div className="h-[84px]" aria-hidden="true" />
        {values.map((value) => (
          <button
            key={value}
            type="button"
            role="option"
            aria-selected={value === selected}
            onClick={() => {
              onSelect(value);
              ref.current?.scrollTo({ top: values.indexOf(value) * ITEM_HEIGHT, behavior: 'smooth' });
            }}
            className={`block w-full h-[42px] snap-center text-sm font-bold transition-colors ${value === selected ? 'text-blue-600' : 'text-slate-400'}`}
          >
            {format(value)}
          </button>
        ))}
        <div className="h-[84px]" aria-hidden="true" />
        <div className="pointer-events-none absolute left-1 right-1 top-[84px] h-[42px] rounded-lg border-y-2 border-blue-200 bg-blue-50/50" aria-hidden="true" />
      </div>
    </div>
  );
};

export const MobileDateWheelPicker: React.FC<MobileDateWheelPickerProps> = ({ value, onChange, minDate }) => {
  const fallback = getTomorrowDate();
  const [selectedYear, selectedMonth, selectedDay] = parseDate(value, fallback);
  const days = useMemo(() => getWheelDays(selectedYear, selectedMonth), [selectedYear, selectedMonth]);
  const safeDay = Math.min(selectedDay, days.length);
  const years = useMemo(() => getWheelYears(new Date(), 10), []);
  const months = getWheelMonths();

  const update = (nextYear: number, nextMonth: number, nextDay: number) => {
    const clampedDay = Math.min(nextDay, getDaysInMonth(nextYear, nextMonth));
    onChange(formatWheelDate(nextYear, nextMonth, clampedDay));
  };

  return (
    <div>
      <div className="mb-2 rounded-xl bg-blue-50 px-4 py-3 text-center text-base font-bold text-blue-700">
        {selectedYear}年{String(selectedMonth).padStart(2, '0')}月{String(safeDay).padStart(2, '0')}日
      </div>
      <div className="flex gap-2" aria-label="滑动选择新完成计划日期">
        <WheelColumn label="年" values={years} selected={selectedYear} onSelect={(next) => update(next, selectedMonth, safeDay)} format={(v) => `${v}`} />
        <WheelColumn label="月" values={months} selected={selectedMonth} onSelect={(next) => update(selectedYear, next, safeDay)} format={(v) => `${String(v).padStart(2, '0')}`} />
        <WheelColumn label="日" values={days} selected={safeDay} onSelect={(next) => update(selectedYear, selectedMonth, next)} format={(v) => `${String(v).padStart(2, '0')}`} />
      </div>
      <p className="mt-2 text-center text-[10px] text-slate-400">上下滑动年、月、日选择日期</p>
    </div>
  );
};
