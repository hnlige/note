import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '../../components/Layout/MainLayout';
import { PaginationFooter } from '../../components/Common/PaginationFooter';
import { DEFAULT_PAGE_SIZE_OPTIONS, paginateItems } from '../../components/Common/pagination';
import { useStore } from '../../store/useStore';
import { formatDateTime } from '../../lib/item-format';
import {
  Clock,
  Eye,
  ChevronRight,
  Filter
} from 'lucide-react';
import { motion } from 'framer-motion';

const Lights: React.FC = () => {
  const { items, lightRecords } = useStore();
  const navigate = useNavigate();
  const formatDate = (d?: string) => d ? d.replace(/T.*$/, '') : '-';
  const [filterColor, setFilterColor] = useState<'ALL' | 'RED' | 'YELLOW'>('ALL');
  const [lightsPage, setLightsPage] = useState(1);
  const [lightsPageSize, setLightsPageSize] = useState<number>(DEFAULT_PAGE_SIZE_OPTIONS[0]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState<number>(DEFAULT_PAGE_SIZE_OPTIONS[0]);

  const filteredItems = useMemo(() => {
    const activeItems = items.filter(i => i.status !== 'DELETED');
    if (filterColor === 'ALL') return activeItems.filter(i => i.lightStatus);
    return activeItems.filter(i => i.lightStatus === filterColor);
  }, [items, filterColor]);
  const lightsPagination = useMemo(
    () => paginateItems(filteredItems, lightsPage, lightsPageSize),
    [filteredItems, lightsPage, lightsPageSize],
  );
  const historyPagination = useMemo(
    () => paginateItems(lightRecords, historyPage, historyPageSize),
    [lightRecords, historyPage, historyPageSize],
  );

  const redCount = items.filter(i => i.lightStatus === 'RED' && i.status !== 'DELETED').length;
  const yellowCount = items.filter(i => i.lightStatus === 'YELLOW' && i.status !== 'DELETED').length;

  useEffect(() => {
    if (lightsPage !== lightsPagination.currentPage) {
      setLightsPage(lightsPagination.currentPage);
    }
  }, [lightsPage, lightsPagination.currentPage]);

  useEffect(() => {
    if (historyPage !== historyPagination.currentPage) {
      setHistoryPage(historyPagination.currentPage);
    }
  }, [historyPage, historyPagination.currentPage]);

  const getColorStyle = (color?: string) => {
    switch (color) {
      case 'RED': return { bg: 'bg-red-500', text: 'text-red-600', badge: 'bg-red-50 text-red-600', label: '红灯' };
      case 'YELLOW': return { bg: 'bg-yellow-500', text: 'text-yellow-600', badge: 'bg-yellow-50 text-yellow-600', label: '黄灯' };
      case 'GREEN': return { bg: 'bg-green-500', text: 'text-green-600', badge: 'bg-green-50 text-green-600', label: '绿灯' };
      default: return { bg: 'bg-slate-300', text: 'text-slate-400', badge: 'bg-slate-50 text-slate-400', label: '无' };
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">亮灯管理</h1>
          <p className="text-slate-500 text-sm mt-1">查看和管理所有事项的红黄绿亮灯状态及历史记录。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
            </div>
            <span className="text-xs font-bold text-slate-400 uppercase">红灯项</span>
          </div>
          <h3 className="text-3xl font-bold text-slate-900">{redCount}</h3>
          <p className="text-xs text-slate-400 mt-2">超期 / 紧急关注</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-yellow-50 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-yellow-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
            </div>
            <span className="text-xs font-bold text-slate-400 uppercase">黄灯项</span>
          </div>
          <h3 className="text-3xl font-bold text-slate-900">{yellowCount}</h3>
          <p className="text-xs text-slate-400 mt-2">即将到期 / 需关注</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-xs font-bold text-slate-400 uppercase">亮灯记录</span>
          </div>
          <h3 className="text-3xl font-bold text-slate-900">{lightRecords.length}</h3>
          <p className="text-xs text-slate-400 mt-2">历史亮灯操作变更</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-6">
        <Filter className="w-4 h-4 text-slate-400" />
        {[
          { key: 'ALL', label: '全部' },
          { key: 'RED', label: '红灯' },
          { key: 'YELLOW', label: '黄灯' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilterColor(tab.key as typeof filterColor)}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
              filterColor === tab.key
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50/50 text-slate-500 text-xs font-bold uppercase tracking-wider">
              <th className="px-6 py-4">事项编号</th>
              <th className="px-6 py-4">事项名称</th>
              <th className="px-6 py-4">亮灯状态</th>
              <th className="px-6 py-4">负责人</th>
              <th className="px-6 py-4">截止日期</th>
              <th className="px-6 py-4 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {lightsPagination.rows.map(item => {
              const style = getColorStyle(item.lightStatus);
              return (
                <motion.tr
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="group hover:bg-slate-50/50 transition-colors"
                >
                  <td className="px-6 py-4">
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded uppercase">
                      {item.serialNo}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-semibold text-slate-900 line-clamp-1">{item.title}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">{item.status}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${style.badge}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${style.bg}`} />
                      {style.label}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 font-medium">
                    {item.ownerName}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {formatDate(item.deadline)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => navigate(`/items/${item.id}`)}
                      className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 ml-auto"
                    >
                      详情 <ChevronRight className="w-4 h-4" />
                    </button>
                  </td>
                </motion.tr>
              );
            })}
            {filteredItems.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400 font-medium">
                  暂无亮灯事项
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {filteredItems.length > 0 && (
          <PaginationFooter
            totalItems={filteredItems.length}
            currentPage={lightsPagination.currentPage}
            totalPages={lightsPagination.totalPages}
            pageSize={lightsPageSize}
            pageSizeOptions={DEFAULT_PAGE_SIZE_OPTIONS}
            itemLabel="事项"
            onPageChange={setLightsPage}
            onPageSizeChange={(nextPageSize) => {
              setLightsPage(1);
              setLightsPageSize(nextPageSize);
            }}
          />
        )}
      </div>

      {lightRecords.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Eye className="w-5 h-5 text-blue-600" />
            亮灯历史记录
          </h3>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50/50 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                  <th className="px-6 py-4">事项</th>
                  <th className="px-6 py-4">颜色</th>
                  <th className="px-6 py-4">触发方式</th>
                  <th className="px-6 py-4">原因</th>
                  <th className="px-6 py-4">操作人</th>
                  <th className="px-6 py-4">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {historyPagination.rows.map(lr => (
                  <tr key={lr.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-xs font-bold text-slate-700">{lr.itemId}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${getColorStyle(lr.color).badge}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${getColorStyle(lr.color).bg}`} />
                        {getColorStyle(lr.color).label}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${lr.triggerMode === 'AUTO' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
                        {lr.triggerMode === 'AUTO' ? '系统自动' : '人工标记'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-600">{lr.reason}</td>
                    <td className="px-6 py-4 text-xs text-slate-600">{lr.operatorName}</td>
                    <td className="px-6 py-4 text-xs text-slate-400">{formatDateTime(lr.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PaginationFooter
              totalItems={lightRecords.length}
              currentPage={historyPagination.currentPage}
              totalPages={historyPagination.totalPages}
              pageSize={historyPageSize}
              pageSizeOptions={DEFAULT_PAGE_SIZE_OPTIONS}
              itemLabel="记录"
              onPageChange={setHistoryPage}
              onPageSizeChange={(nextPageSize) => {
                setHistoryPage(1);
                setHistoryPageSize(nextPageSize);
              }}
            />
          </div>
        </div>
      )}
    </MainLayout>
  );
};

export default Lights;
