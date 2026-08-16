import React from 'react';

interface PaginationFooterProps {
  totalItems: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  itemLabel?: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export const PaginationFooter: React.FC<PaginationFooterProps> = ({
  totalItems,
  currentPage,
  totalPages,
  pageSize,
  pageSizeOptions,
  itemLabel = '条',
  onPageChange,
  onPageSizeChange,
}) => {
  const safeTotalPages = Math.max(totalPages, 1);
  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < safeTotalPages;

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-4 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
      <div>
        共 <span className="font-semibold text-slate-700">{totalItems}</span> {itemLabel}
        <span className="mx-2 text-slate-300">/</span>
        第 <span className="font-semibold text-slate-700">{currentPage}</span> / {safeTotalPages} 页
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none transition-all hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          aria-label="每页条数"
        >
          {pageSizeOptions.map(option => (
            <option key={option} value={option}>
              每页 {option} 条
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={!canGoPrevious}
          onClick={() => onPageChange(currentPage - 1)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-600 transition-all enabled:hover:border-blue-200 enabled:hover:bg-blue-50 enabled:hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          上一页
        </button>
        <button
          type="button"
          disabled={!canGoNext}
          onClick={() => onPageChange(currentPage + 1)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-600 transition-all enabled:hover:border-blue-200 enabled:hover:bg-blue-50 enabled:hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </div>
  );
};
