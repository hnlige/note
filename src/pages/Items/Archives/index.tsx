import React from 'react';
import { MainLayout } from '../../../components/Layout/MainLayout';
import { useStore } from '../../../store/useStore';
import { 
  Archive, 
  Search, 
  Download, 
  Star, 
  Calendar, 
  User, 
  ChevronRight,
  Filter,
  BarChart
} from 'lucide-react';
import { motion } from 'framer-motion';
import { downloadCsv } from '../../../lib/export-csv';
import { canUsePageAction } from '../../../store/role-access';

const Archives: React.FC = () => {
  const { items, currentUser, roles } = useStore();
  const [searchTerm, setSearchTerm] = React.useState('');
  const canExportArchives = canUsePageAction(currentUser, roles, 'MENU_ARCHIVES', 'EXPORT');
  
  const archivedItems = items.filter(i => 
    i.status === 'ARCHIVED' && 
    (i.title.toLowerCase().includes(searchTerm.toLowerCase()) || i.serialNo.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const averageRating = React.useMemo(() => {
    if (archivedItems.length === 0) return 0;
    const sum = archivedItems.reduce((acc, item) => acc + (item.rating || 5), 0);
    return (sum / archivedItems.length).toFixed(1);
  }, [archivedItems]);

  const handleExport = () => {
    downloadCsv(
      `归档台账_${new Date().toISOString().split('T')[0]}.csv`,
      ['督办序号', '标题', '办结日期', '责任人', '评分'],
      archivedItems.map((item) => [
        item.serialNo,
        item.title,
        item.lastFeedbackDate || '',
        item.ownerName,
        item.rating || 5,
      ]),
    );
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">归档台账</h1>
          <p className="text-slate-500 text-sm mt-1">查看所有已办结并结案的事项，包含最终评价与执行效能。</p>
        </div>
        <div className="flex items-center gap-3">
          <select className="bg-white border border-slate-200 text-sm font-bold text-slate-700 rounded-lg py-2 px-4 focus:ring-2 focus:ring-blue-500 cursor-pointer">
            <option>2026 年度</option>
            <option>2025 年度</option>
          </select>
          {canExportArchives && (
            <button
              onClick={handleExport}
              className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-semibold hover:bg-slate-50 transition-all"
            >
              <Download className="w-4 h-4" />
              <span>全量归档导出</span>
            </button>
          )}
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm mb-8 flex items-center justify-between">
        <div className="flex items-center gap-12">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">归档总数</p>
            <h3 className="text-2xl font-bold text-slate-900">{archivedItems.length} <span className="text-sm font-medium text-slate-400">项</span></h3>
          </div>
          <div className="w-px h-10 bg-slate-100" />
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">平均评分</p>
            <div className="flex items-center gap-1">
              <h3 className="text-2xl font-bold text-slate-900">{averageRating}</h3>
              <div className="flex">
                {[1,2,3,4,5].map(i => (
                  <Star 
                    key={i} 
                    className={`w-3.5 h-3.5 ${i <= Math.round(Number(averageRating)) ? 'fill-yellow-400 text-yellow-400' : 'text-slate-200'}`} 
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="relative max-w-sm w-full">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text" 
            placeholder="搜索归档事项..."
            className="w-full bg-slate-50 border-none rounded-lg py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-blue-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50/50 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
              <th className="px-6 py-4">督办项 (归档)</th>
              <th className="px-6 py-4">办结日期</th>
              <th className="px-6 py-4">责任单位</th>
              <th className="px-6 py-4">结案评价</th>
              <th className="px-6 py-4 text-right">档案</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {archivedItems.length > 0 ? archivedItems.map((item, index) => (
              <motion.tr
                key={item.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: index * 0.05 }}
                className="group hover:bg-slate-50/50 transition-colors"
              >
                <td className="px-6 py-4">
                  <p className="text-sm font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded w-fit mb-1 uppercase tracking-tighter italic">{item.serialNo}</p>
                  <p className="text-sm font-bold text-slate-700">{item.title}</p>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Calendar className="w-4 h-4" />
                    <span className="text-sm">{item.lastFeedbackDate}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-slate-400" />
                    <span className="text-sm text-slate-600 font-medium">{item.ownerName}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-1 text-yellow-500 cursor-pointer group/rating">
                    {[1, 2, 3, 4, 5].map(star => (
                      <Star 
                        key={star} 
                        className={`w-4 h-4 transition-transform group-hover/rating:scale-110 ${star <= 4 ? 'fill-current' : 'fill-current opacity-30'}`} 
                      />
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <button className="text-sm font-bold text-blue-600 hover:text-blue-700 px-4 py-2 hover:bg-blue-50 rounded-lg transition-all flex items-center gap-1 ml-auto">
                    档案摘要 <ChevronRight className="w-4 h-4" />
                  </button>
                </td>
              </motion.tr>
            )) : (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-400 font-medium">
                  暂无归档事项
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </MainLayout>
  );
};

export default Archives;
