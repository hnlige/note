export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50];

export interface PaginationResult<T> {
  totalPages: number;
  currentPage: number;
  rows: T[];
}

export function paginateItems<T>(rows: readonly T[], page: number, pageSize: number): PaginationResult<T> {
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : DEFAULT_PAGE_SIZE_OPTIONS[0];
  const totalPages = Math.max(1, Math.ceil(rows.length / safePageSize));
  const requestedPage = Number.isFinite(page) ? Math.floor(page) : 1;
  const currentPage = Math.min(Math.max(requestedPage, 1), totalPages);
  const start = (currentPage - 1) * safePageSize;

  return {
    totalPages,
    currentPage,
    rows: rows.slice(start, start + safePageSize),
  };
}
