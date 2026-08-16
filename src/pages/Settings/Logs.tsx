import React, { useMemo, useState } from 'react';
import { Download, FileText, Search } from 'lucide-react';
import { MainLayout } from '../../components/Layout/MainLayout';
import { PaginationFooter } from '../../components/Common/PaginationFooter';
import { DEFAULT_PAGE_SIZE_OPTIONS, paginateItems } from '../../components/Common/pagination';
import { useStore } from '../../store/useStore';
import { downloadCsv } from '../../lib/export-csv';
import { buildLogsExport, canExportLogs, matchesLogKeyword } from './logs-export';
import { formatDateTime } from '../../lib/item-format';

const Logs: React.FC = () => {
  const { logs, currentUser, roles } = useStore();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE_OPTIONS[0]);

  const filteredLogs = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) return logs;
    return logs.filter(log => matchesLogKeyword(log, query));
  }, [keyword, logs]);

  const pagination = useMemo(
    () => paginateItems(filteredLogs, page, pageSize),
    [filteredLogs, page, pageSize],
  );
  const canExport = canExportLogs(currentUser, roles);

  const handleExport = () => {
    if (filteredLogs.length === 0) return;
    const exportConfig = buildLogsExport(filteredLogs);
    downloadCsv(`操作日志-${new Date().toISOString().slice(0, 10)}.csv`, exportConfig.headers, exportConfig.rows);
  };

  return (
    <MainLayout>
      <div className="mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">操作日志</h1>
            <p className="text-slate-500 text-sm mt-1">查看系统关键操作记录，便于审计追踪。</p>
          </div>
        </div>
        {canExport && (
          <button
            type="button"
            onClick={handleExport}
            disabled={filteredLogs.length === 0}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            <span>导出日志</span>
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setPage(1);
              }}
              placeholder="搜索用户、操作、模块、IP..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-4">时间</th>
                <th className="px-6 py-4">用户</th>
                <th className="px-6 py-4">模块</th>
                <th className="px-6 py-4">操作</th>
                <th className="px-6 py-4">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {pagination.rows.map(log => (
                <tr key={log.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-6 py-4 text-sm text-slate-500">{formatDateTime(log.timestamp)}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-slate-700">{log.userName}</td>
                  <td className="px-6 py-4">
                    <span className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-bold text-blue-600">{log.module}</span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-700">{log.action}</td>
                  <td className="px-6 py-4 text-sm text-slate-400">{log.ip}</td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-400">
                    暂无匹配的操作日志
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filteredLogs.length > 0 && (
          <PaginationFooter
            totalItems={filteredLogs.length}
            currentPage={pagination.currentPage}
            totalPages={pagination.totalPages}
            pageSize={pageSize}
            pageSizeOptions={DEFAULT_PAGE_SIZE_OPTIONS}
            itemLabel="日志"
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPage(1);
              setPageSize(nextPageSize);
            }}
          />
        )}
      </div>
    </MainLayout>
  );
};

export default Logs;
