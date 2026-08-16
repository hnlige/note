import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Filter, RotateCcw, Search, X } from 'lucide-react';
import { normalizeManualDateInput } from '../../../lib/item-format';
import { DepartmentFilterOption, filterDepartmentOptions } from '../department-filter';

interface FilterPanelProps {
  statusFilter: string;
  onStatusChange: (value: string) => void;
  departmentFilter: string;
  onDepartmentChange: (value: string) => void;
  dateFrom: string;
  onDateFromChange: (value: string) => void;
  dateTo: string;
  onDateToChange: (value: string) => void;
  localSearch: string;
  onLocalSearchChange: (value: string) => void;
  onReset: () => void;
  departmentOptions?: DepartmentFilterOption[];
}

export const FilterPanel: React.FC<FilterPanelProps> = ({
  statusFilter,
  onStatusChange,
  departmentFilter,
  onDepartmentChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  localSearch,
  onLocalSearchChange,
  onReset,
  departmentOptions = [],
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [departmentKeyword, setDepartmentKeyword] = useState('');
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);
  const deptList = useMemo(
    () => filterDepartmentOptions(departmentOptions, departmentKeyword),
    [departmentOptions, departmentKeyword],
  );
  const selectedDepartmentOption = useMemo(
    () => departmentOptions.find((option) => option.value === departmentFilter) || null,
    [departmentFilter, departmentOptions],
  );

  useEffect(() => {
    if (selectedDepartmentOption) {
      setDepartmentKeyword(selectedDepartmentOption.label);
      return;
    }
    setDepartmentKeyword('');
  }, [selectedDepartmentOption]);

  useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        setShowDepartmentDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, []);

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Filter className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-bold text-slate-900">综合筛选</h3>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setDepartmentKeyword('');
              onReset();
            }}
            className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-blue-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-blue-50"
          >
            <RotateCcw className="w-4 h-4" />
            <span>重置筛选</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">事项状态</label>
          <select
            value={statusFilter}
            onChange={(e) => onStatusChange(e.target.value)}
            className="w-full bg-slate-50 border-none rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
          >
            <option value="">全部状态</option>
            <option value="PENDING">待签收</option>
            <option value="EXECUTING">执行中</option>
            <option value="OVERDUE">已超时</option>
            <option value="DELAYED">已延期</option>
            <option value="SUSPENDED">已暂缓</option>
            <option value="COMPLETED">已办结</option>
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">责任部门</label>
          <div ref={panelRef} className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="搜索并选择组织/部门"
              value={departmentKeyword}
              onFocus={() => setShowDepartmentDropdown(true)}
              onChange={(e) => {
                const value = e.target.value;
                setDepartmentKeyword(value);
                setShowDepartmentDropdown(true);
                if (!value.trim()) {
                  onDepartmentChange('');
                }
              }}
              className="w-full bg-slate-50 border-none rounded-lg py-2 pl-10 pr-16 text-sm focus:ring-2 focus:ring-blue-500 transition-all"
            />
            {departmentKeyword && (
              <button
                type="button"
                onClick={() => {
                  setDepartmentKeyword('');
                  setShowDepartmentDropdown(true);
                  onDepartmentChange('');
                }}
                className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                title="清空责任部门筛选"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowDepartmentDropdown((value) => !value)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              title="展开责任部门选项"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showDepartmentDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showDepartmentDropdown && (
              <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onDepartmentChange('');
                    setDepartmentKeyword('');
                    setShowDepartmentDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-600 hover:bg-blue-50 border-b border-slate-100"
                >
                  全部部门
                </button>
                <div className="max-h-56 overflow-y-auto">
                  {deptList.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-slate-400 text-center">无匹配部门</div>
                  ) : (
                    deptList.map((option) => (
                      <button
                        key={option.deptId}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          onDepartmentChange(option.value);
                          setDepartmentKeyword(option.label);
                          setShowDepartmentDropdown(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                          departmentFilter === option.value
                            ? 'bg-blue-50 text-blue-700 font-semibold'
                            : 'text-slate-700 hover:bg-blue-50'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">截止日期</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              placeholder="2026/06/03"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              onBlur={(e) => onDateFromChange(normalizeManualDateInput(e.target.value))}
              className="w-full bg-slate-50 border-none rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all"
            />
            <span className="text-slate-400 shrink-0">-</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="2026/06/03"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              onBlur={(e) => onDateToChange(normalizeManualDateInput(e.target.value))}
              className="w-full bg-slate-50 border-none rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">模糊搜索</label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="搜索标题、字号、负责人、跟进人..."
              value={localSearch}
              onChange={(e) => onLocalSearchChange(e.target.value)}
              className="w-full bg-slate-50 border-none rounded-lg py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
