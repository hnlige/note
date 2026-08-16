import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { PaginationFooter } from '../../components/Common/PaginationFooter';
import { DEFAULT_PAGE_SIZE_OPTIONS, paginateItems } from '../../components/Common/pagination';
import { MainLayout } from '../../components/Layout/MainLayout';
import { useStore } from '../../store/useStore';
import { useNavigate } from 'react-router-dom';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  LineChart,
  Line,
  Legend
} from 'recharts';
import { 
  BarChart3, 
  TrendingUp, 
  PieChart as PieChartIcon, 
  ArrowUpRight, 
  ArrowDownRight,
  Download,
  Calendar,
  CheckCircle2, 
  AlertCircle,
  X,
  Eye
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getItemStatusLabel, getItemStatusStyle } from '../../lib/item-format';
import { downloadCsv } from '../../lib/export-csv';
import { canUsePageAction } from '../../store/role-access';

const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

const Statistics: React.FC = () => {
  const { items, currentUser, roles } = useStore();
  const navigate = useNavigate();
  const formatDate = (d?: string) => d ? d.replace(/T.*$/, '') : '-';
  const [drilldown, setDrilldown] = useState<{ title: string; items: typeof items } | null>(null);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerPageSize, setLedgerPageSize] = useState<number>(DEFAULT_PAGE_SIZE_OPTIONS[0]);
  const canExportStatistics = useMemo(
    () => canUsePageAction(currentUser, roles, 'MENU_STATISTICS', 'EXPORT'),
    [currentUser, roles],
  );

  // Aggregate data for charts
  const categoryData = useMemo(() => {
    const categories: Record<string, number> = {};
    items.filter(i => i.status !== 'DELETED').forEach(item => {
      categories[item.category] = (categories[item.category] || 0) + 1;
    });
    return Object.entries(categories).map(([name, value]) => ({ name, value }));
  }, [items]);

  const handleDrilldown = useCallback((title: string, filteredItems: typeof items) => {
    setDrilldown({ title, items: filteredItems });
  }, []);

  // 部门办结率：基于实际事项数据计算
  const departmentPerformance = useMemo(() => {
    const activeItems = items.filter(i => i.status !== 'DELETED');
    const deptMap: Record<string, { total: number; completed: number }> = {};
    activeItems.forEach(item => {
      const depts = item.deptNames?.length ? item.deptNames : [];
      const deptName = depts[0] || '未分配';
      if (!deptMap[deptName]) deptMap[deptName] = { total: 0, completed: 0 };
      deptMap[deptName].total++;
      if (item.status === 'COMPLETED' || item.status === 'ARCHIVED') deptMap[deptName].completed++;
    });
    return Object.entries(deptMap)
      .map(([name, d]) => ({ name, rate: d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0, total: d.total }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 5);
  }, [items]);

  // 执行趋势：基于实际事项的 deadline 月份统计
  const trendData = useMemo(() => {
    const activeItems = items.filter(i => i.status !== 'DELETED');
    const monthMap: Record<string, { completed: number; delayed: number }> = {};
    activeItems.forEach(item => {
      if (!item.deadline) return;
      const d = new Date(item.deadline);
      if (isNaN(d.getTime())) return;
      const month = `${d.getMonth() + 1}月`;
      if (!monthMap[month]) monthMap[month] = { completed: 0, delayed: 0 };
      if (item.status === 'COMPLETED' || item.status === 'ARCHIVED') monthMap[month].completed++;
      if (item.status === 'OVERDUE') monthMap[month].delayed++;
    });
    // 按月份排序
    const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    return months
      .filter(m => monthMap[m])
      .map(m => ({ month: m, completed: monthMap[m].completed, delayed: monthMap[m].delayed }));
  }, [items]);

  const metrics = useMemo(() => {
    const activeItems = items.filter(i => i.status !== 'DELETED');
    const total = activeItems.length;
    const completed = activeItems.filter(i => i.status === 'COMPLETED' || i.status === 'ARCHIVED').length;
    const delayed = activeItems.filter(i => i.status === 'OVERDUE').length;
    const rate = total > 0 ? ((completed / total) * 100).toFixed(1) : '0';
    
    return [
      { 
        title: '全院平均办结率', 
        value: `${rate}%`, 
        trend: '+2.4%', 
        up: true, 
        icon: TrendingUp, 
        color: 'text-green-600', 
        bg: 'bg-green-50',
        clickable: true
      },
      { 
        title: '事项平均办结周期', 
        value: '5.2天', 
        trend: '-0.8天', 
        up: false, 
        icon: BarChart3, 
        color: 'text-blue-600', 
        bg: 'bg-blue-50',
        clickable: false
      },
      { 
        title: '累计办结事项', 
        value: completed.toString(), 
        trend: '+15', 
        up: true, 
        icon: CheckCircle2, 
        color: 'text-indigo-600', 
        bg: 'bg-indigo-50',
        clickable: true
      },
      { 
        title: '逾期警示事项', 
        value: delayed.toString(), 
        trend: '-3', 
        up: false, 
        icon: AlertCircle, 
        color: 'text-red-600', 
        bg: 'bg-red-50',
        clickable: true
      },
    ];
  }, [items]);
  const ledgerItems = useMemo(
    () => items.filter(i => i.status !== 'DELETED'),
    [items],
  );
  const ledgerPagination = useMemo(
    () => paginateItems(ledgerItems, ledgerPage, ledgerPageSize),
    [ledgerItems, ledgerPage, ledgerPageSize],
  );

  useEffect(() => {
    if (ledgerPage !== ledgerPagination.currentPage) {
      setLedgerPage(ledgerPagination.currentPage);
    }
  }, [ledgerPage, ledgerPagination.currentPage]);

  const handleExport = () => {
    downloadCsv(
      `统计分析报表_${new Date().toISOString().split('T')[0]}.csv`,
      ['类型', '名称', '数值', '责任人', '截止日期'],
      [
        ...metrics.map((metric) => ['指标', metric.title, metric.value, '', '']),
        ...ledgerItems.map((item) => [
          '事项',
          `${item.serialNo} ${item.title}`,
          getItemStatusLabel(item.status),
          item.ownerName,
          formatDate(item.deadline),
        ]),
      ],
    );
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">统计分析看板</h1>
          <p className="text-slate-500 text-sm mt-1">全院督办效能全景视图，支持数据穿透与下钻。</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-semibold text-slate-700">2026年上半年</span>
          </div>
          {canExportStatistics && (
            <button
              onClick={handleExport}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-all shadow-sm active:scale-95"
            >
              <Download className="w-4 h-4" />
              <span>导出报表</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {metrics.map((kpi, index) => {
          const content = (
            <>
              <div className="flex items-center justify-between mb-4">
                <div className={`p-2.5 rounded-xl ${kpi.bg} ${kpi.color}`}>
                  <kpi.icon className="w-5 h-5" />
                </div>
                <div className={`flex items-center gap-0.5 text-xs font-bold ${kpi.up ? 'text-green-600' : 'text-blue-600'}`}>
                  {kpi.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {kpi.trend}
                </div>
              </div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider text-left">{kpi.title}</p>
              <h3 className="text-2xl font-bold text-slate-900 mt-1 text-left">{kpi.value}</h3>
            </>
          );

          if (kpi.clickable) {
              return (
                <div
                  key={kpi.title}
                >
                  <button
                    type="button"
                    onClick={() => {
                      const activeItems = items.filter(i => i.status !== 'DELETED');
                      if (kpi.title === '全院平均办结率' || kpi.title === '累计办结事项') {
                        setDrilldown({ title: '已办结/归档事项', items: activeItems.filter(i => i.status === 'COMPLETED' || i.status === 'ARCHIVED') });
                      } else if (kpi.title === '逾期警示事项') {
                        setDrilldown({ title: '逾期事项', items: activeItems.filter(i => i.status === 'OVERDUE') });
                      }
                    }}
                    className="w-full bg-white p-6 rounded-2xl border border-slate-100 shadow-sm cursor-pointer hover:border-blue-200 hover:shadow-md transition-all text-left"
                  >
                    {content}
                  </button>
                </div>
              );
            }

          return (
            <motion.div
              key={kpi.title}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 }}
              className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm"
            >
              {content}
            </motion.div>
          );
        })}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Department Performance Bar Chart */}
        <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-600" />
              部门办结率排行 (Top 5)
            </h3>
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={departmentPerformance} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                <XAxis type="number" hide />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fontWeight: 600, fill: '#64748b' }} 
                />
                <Tooltip 
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                />
                <Bar 
                  dataKey="rate" 
                  fill="#2563EB" 
                  radius={[0, 8, 8, 0]} 
                  barSize={24}
                  className="cursor-pointer"
                  onClick={(data) => handleDrilldown(`${data.name} 督办事项`, items.filter(i => i.status !== 'DELETED' && i.ownerName.includes(data.name.substring(0, 2))))}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Category Pie Chart */}
        <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <PieChartIcon className="w-5 h-5 text-indigo-600" />
              督办事项分类占比
            </h3>
          </div>
          <div className="h-[300px] flex items-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={8}
                  dataKey="value"
                  className="cursor-pointer"
                  onClick={(data) => handleDrilldown(`${data.name} 分类事项`, items.filter(i => i.status !== 'DELETED' && i.category === data.name))}
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                />
                <Legend 
                  layout="vertical" 
                  verticalAlign="middle" 
                  align="right"
                  formatter={(value) => <span className="text-xs font-bold text-slate-600">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Trend Line Chart */}
      <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm mb-8">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-600" />
            执行趋势分析 (2026 H1)
          </h3>
        </div>
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis 
                dataKey="month" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 12, fontWeight: 600, fill: '#64748b' }} 
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 12, fontWeight: 600, fill: '#64748b' }} 
              />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
              />
              <Legend verticalAlign="top" align="right" />
              <Line 
                type="monotone" 
                dataKey="completed" 
                stroke="#2563EB" 
                strokeWidth={3} 
                dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} 
                activeDot={{ r: 6 }} 
                name="办结数"
              />
              <Line 
                type="monotone" 
                dataKey="delayed" 
                stroke="#EF4444" 
                strokeWidth={3} 
                dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} 
                activeDot={{ r: 6 }} 
                name="逾期数"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Unified Ledger Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mt-8">
        <div className="p-6 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">统一台账</h3>
          <p className="text-xs text-slate-500 mt-1">一事一项台账查询，支持多维筛选、导出与打印。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 text-slate-500 text-xs font-bold uppercase tracking-wider">
                <th className="px-6 py-4">事项编号</th>
                <th className="px-6 py-4">事项名称</th>
                <th className="px-6 py-4">分类</th>
                <th className="px-6 py-4">状态</th>
                <th className="px-6 py-4">负责人</th>
                <th className="px-6 py-4">截止日期</th>
                <th className="px-6 py-4 text-right">进度</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {ledgerPagination.rows.map((item) => (
                <tr 
                  key={item.id}
                  className="group hover:bg-slate-50/50 transition-colors cursor-pointer"
                  onClick={() => navigate(`/items/${item.id}`)}
                >
                  <td className="px-6 py-4">
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded uppercase">{item.serialNo}</span>
                  </td>
                  <td className="px-6 py-4 text-sm font-bold text-slate-900">{item.title}</td>
                  <td className="px-6 py-4 text-xs text-slate-500">{item.category}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${getItemStatusStyle(item.status)}`}>
                      {getItemStatusLabel(item.status)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-700">{item.ownerName}</td>
                  <td className="px-6 py-4 text-sm font-bold text-slate-900">{formatDate(item.deadline)}</td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-xs font-bold text-slate-700">{item.progress}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ledgerItems.length > 0 && (
          <PaginationFooter
            totalItems={ledgerItems.length}
            currentPage={ledgerPagination.currentPage}
            totalPages={ledgerPagination.totalPages}
            pageSize={ledgerPageSize}
            pageSizeOptions={DEFAULT_PAGE_SIZE_OPTIONS}
            itemLabel="事项"
            onPageChange={setLedgerPage}
            onPageSizeChange={(nextPageSize) => {
              setLedgerPage(1);
              setLedgerPageSize(nextPageSize);
            }}
          />
        )}
      </div>

      {/* Drilldown Modal */}
      <AnimatePresence>
        {drilldown && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100]"
              onClick={() => setDrilldown(null)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] max-w-[90vw] max-h-[80vh] bg-white rounded-3xl shadow-2xl z-[101] overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-200">
                    <Eye className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{drilldown.title}</h3>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">共 {drilldown.items.length} 条记录</p>
                  </div>
                </div>
                <button 
                  onClick={() => setDrilldown(null)}
                  className="p-2 hover:bg-white rounded-xl text-slate-400 hover:text-slate-900 transition-all border border-transparent hover:border-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6">
                <table className="w-full">
                  <thead>
                    <tr className="text-left border-b border-slate-100">
                      <th className="pb-4 text-xs font-bold text-slate-400 uppercase tracking-wider">事项编号</th>
                      <th className="pb-4 text-xs font-bold text-slate-400 uppercase tracking-wider">事项名称</th>
                      <th className="pb-4 text-xs font-bold text-slate-400 uppercase tracking-wider">负责人</th>
                      <th className="pb-4 text-xs font-bold text-slate-400 uppercase tracking-wider">截止日期</th>
                      <th className="pb-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">进度</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {drilldown.items.map(item => (
                      <tr 
                        key={item.id} 
                        className="group hover:bg-slate-50 transition-colors cursor-pointer"
                        onClick={() => navigate(`/items/${item.id}`)}
                      >
                        <td className="py-4 text-sm font-bold text-slate-400 font-mono">{item.serialNo}</td>
                        <td className="py-4">
                          <p className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{item.title}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">{item.category}</p>
                        </td>
                        <td className="py-4 text-sm font-bold text-slate-700">{item.ownerName}</td>
                        <td className="py-4 text-sm font-bold text-slate-500">{formatDate(item.deadline)}</td>
                        <td className="py-4 text-right">
                          <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                            item.progress === 100 ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'
                          }`}>
                            {item.progress}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
                <button 
                  onClick={() => navigate('/items')}
                  className="text-sm font-bold text-blue-600 hover:text-blue-700 transition-colors"
                >
                  查看全部督办事项
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </MainLayout>
  );
};

export default Statistics;
