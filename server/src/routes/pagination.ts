export type PageRequest = { page: number; pageSize: number };

export function getPageRequest(query: Record<string, unknown>, defaultPageSize = 100, maxPageSize = 200): PageRequest {
  const positive = (value: unknown, fallback: number, maximum: number) => {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
  };
  return {
    page: positive(query.page, 1, 1_000_000),
    pageSize: positive(query.pageSize, defaultPageSize, maxPageSize),
  };
}

export function buildPagination(page: PageRequest, total: number) {
  return {
    page: page.page,
    pageSize: page.pageSize,
    total,
    totalPages: Math.ceil(total / page.pageSize),
  };
}
