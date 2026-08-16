import React from 'react';
import { MainLayout } from '../../components/Layout/MainLayout';
import { useStore } from '../../store/useStore';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  User, 
  FileText, 
  Star,
  MessageSquare,
  ChevronRight,
  AlertCircle,
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../../lib/api';
import { useToast } from '../../components/Common/Toast';

const AuditPage: React.FC = () => {
  const { auditRecords, syncAuditRecords, syncItems, addLog, currentUser } = useStore();
  const { showToast } = useToast();
  const [ratings, setRatings] = React.useState<Record<string, number>>({});
  const [evaluations, setEvaluations] = React.useState<Record<string, string>>({});
  const [processingId, setProcessingId] = React.useState<string | null>(null);
  const pendingRecords = auditRecords.filter(r => r.status === 'PENDING' || r.status === 'FOLLOWER_APPROVED');

  React.useEffect(() => {
    syncAuditRecords().catch((error) => {
      showToast(error instanceof Error ? error.message : '加载审核记录失败', 'error');
    });
  }, [showToast, syncAuditRecords]);

  const handleAudit = async (recordId: string, itemId: string, approved: boolean) => {
    const record = auditRecords.find(r => r.id === recordId);
    if (!record) return;

    const rating = ratings[recordId] || 5;
    const evaluation = evaluations[recordId] || '';

    setProcessingId(recordId);
    try {
      await api.items.update(itemId, {
        status: approved ? 'COMPLETED' : 'EXECUTING',
        ...(approved ? { auditRating: rating, auditEvaluation: evaluation } : { rejectReason: evaluation || '审核未通过' }),
      }, 'MENU_AUDIT');
      await Promise.all([syncAuditRecords(), syncItems()]);
      await addLog({
        userName: currentUser.name,
        userId: currentUser.id,
        action: approved ? `通过审核并评价(${rating}星)` : '驳回审核',
        module: '督办审核'
      });
      showToast(approved ? '审核已通过' : '审核已驳回', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '审核处理失败', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">办结审核中心</h1>
          <p className="text-slate-500 text-sm mt-1">管理员查阅承办单位提交的结案报告，评价执行效能并确认归档。</p>
        </div>
        <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-xl border border-slate-100">
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-bold text-slate-400 uppercase">待审核任务</span>
            <span className="text-sm font-bold text-blue-600">{pendingRecords.length} 项</span>
          </div>
          <div className="w-px h-8 bg-slate-100" />
          <Clock className="w-5 h-5 text-slate-300" />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Left: Pending List */}
        <div className="xl:col-span-2 space-y-4">
          <AnimatePresence mode="popLayout">
            {pendingRecords.map((record, index) => (
              <motion.div
                key={record.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: index * 0.1 }}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden group hover:shadow-md transition-all"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                        <FileText className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">{record.itemTitle}</h3>
                        <div className="flex items-center gap-4 mt-1">
                          <span className="flex items-center gap-1 text-xs text-slate-400 font-medium">
                            <User className="w-3 h-3" />
                            提交人: {record.submitter}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-slate-400 font-medium">
                            <Clock className="w-3 h-3" />
                            提交时间: {record.submitTime}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleAudit(record.id, record.itemId, false)}
                        disabled={processingId === record.id}
                        className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="驳回"
                      >
                        <XCircle className="w-6 h-6" />
                      </button>
                      <button 
                        onClick={() => handleAudit(record.id, record.itemId, true)}
                        disabled={processingId === record.id}
                        className="p-2 text-green-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-all"
                        title="通过"
                      >
                        <CheckCircle2 className="w-6 h-6" />
                      </button>
                    </div>
                  </div>

                  <div className="bg-slate-50 rounded-xl p-4 mb-6 border border-slate-100">
                    <div className="flex items-center gap-2 mb-2">
                      <MessageSquare className="w-4 h-4 text-slate-400" />
                      <span className="text-xs font-bold text-slate-500 uppercase">结案报告摘要</span>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {record.content}
                    </p>
                  </div>

                  <div className="flex flex-col gap-4 pt-4 border-t border-slate-50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-6">
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">执行效能评价</p>
                          <div className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map(i => (
                              <button
                                key={i}
                                onClick={() => setRatings({ ...ratings, [record.id]: i })}
                                className="transition-transform hover:scale-110 active:scale-95"
                              >
                                <Star 
                                  className={`w-5 h-5 ${(ratings[record.id] || 5) >= i ? 'fill-yellow-400 text-yellow-400' : 'text-slate-200'}`} 
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {['响应迅速', '材料详实', '超预期完成'].map(tag => (
                            <span key={tag} className="px-2 py-1 bg-white border border-slate-200 rounded-md text-[10px] font-bold text-slate-500">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button className="flex items-center gap-1 text-sm font-bold text-blue-600 hover:text-blue-700 transition-colors">
                        查看完整案卷
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">管理员评语 (可选)</p>
                      <textarea
                        value={evaluations[record.id] || ''}
                        onChange={(e) => setEvaluations({ ...evaluations, [record.id]: e.target.value })}
                        placeholder="请输入对该事项执行情况的评价..."
                        className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all resize-none h-20"
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {pendingRecords.length === 0 && (
            <div className="bg-white rounded-2xl border border-dashed border-slate-200 py-20 flex flex-col items-center justify-center text-slate-400">
              <CheckCircle2 className="w-16 h-16 mb-4 opacity-20 text-green-500" />
              <p className="text-lg font-bold">所有申请已处理完毕</p>
              <p className="text-sm mt-1">当前没有待审核的结案报告</p>
            </div>
          )}
        </div>

        {/* Right: Stats & Filter */}
        <div className="xl:col-span-1 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-6">审核效能统计</h3>
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">平均审核耗时</span>
                <span className="text-sm font-bold text-slate-900">4.2 小时</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">本月审核总量</span>
                <span className="text-sm font-bold text-slate-900">45 项</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">一次性通过率</span>
                <span className="text-sm font-bold text-green-600">92%</span>
              </div>
            </div>
            <div className="mt-8 pt-8 border-t border-slate-50">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center text-orange-500">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <p className="text-xs font-bold text-slate-600">审核提醒</p>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                有 2 项督办事项提交已超过 48 小时未处理，请尽快审阅并给出评价。
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">快速检索</h3>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text"
                placeholder="搜索历史记录..."
                className="w-full bg-slate-50 border-none rounded-lg py-2 pl-10 pr-4 text-xs focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default AuditPage;
