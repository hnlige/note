import React from 'react';
import { MainLayout } from '../../components/Layout/MainLayout';
import { normalizeRemoteItem, useStore } from '../../store/useStore';
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
  Search,
  X,
  Download,
  Paperclip,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../../lib/api';
import { useToast } from '../../components/Common/Toast';
import type { AuditRecord, SupervisionItem } from '../../types';
import { formatDateTime, getItemStatusLabel, getItemStatusStyle, formatUrgeTimelineContent } from '../../lib/item-format';
import { canUsePageAction } from '../../store/role-access';

const AuditPage: React.FC = () => {
  const { auditRecords, syncAuditRecords, syncItems, addLog, currentUser, roles } = useStore();
  const { showToast } = useToast();
  const [ratings, setRatings] = React.useState<Record<string, number>>({});
  const [evaluations, setEvaluations] = React.useState<Record<string, string>>({});
  const [processingId, setProcessingId] = React.useState<string | null>(null);
  const pendingRecords = auditRecords.filter(r => r.status === 'PENDING' || r.status === 'FOLLOWER_APPROVED');
  // 审核动作按「办结审核」页面口径判定，与提交时 X-Page-Auth=MENU_AUDIT 的后端校验一致，
  // 角色配置页取消审核通过/驳回后按钮隐藏，避免“可见但提交 403”。
  const canApproveAudit = canUsePageAction(currentUser, roles, 'MENU_AUDIT', 'APPROVE_ITEM');
  const canRejectAudit = canUsePageAction(currentUser, roles, 'MENU_AUDIT', 'REJECT_ITEM');

  // ─── 完整案卷弹窗状态 ───
  const [caseFileRecordId, setCaseFileRecordId] = React.useState<string | null>(null);
  const caseFileRecord: AuditRecord | null = caseFileRecordId
    ? auditRecords.find(r => r.id === caseFileRecordId) ?? null
    : null;
  const [caseFileItem, setCaseFileItem] = React.useState<SupervisionItem | null>(null);
  const [caseFileLoading, setCaseFileLoading] = React.useState(false);
  const [caseFileError, setCaseFileError] = React.useState('');

  React.useEffect(() => {
    syncAuditRecords().catch((error) => {
      showToast(error instanceof Error ? error.message : '加载审核记录失败', 'error');
    });
  }, [showToast, syncAuditRecords]);

  // 打开案卷弹窗后实时拉取事项详情（含附件签名下载地址与完整时间线）。
  React.useEffect(() => {
    if (!caseFileRecord) return;
    let cancelled = false;
    setCaseFileLoading(true);
    setCaseFileError('');
    setCaseFileItem(null);
    api.items.getById(caseFileRecord.itemId)
      .then((serverItem) => {
        if (cancelled) return;
        setCaseFileItem(normalizeRemoteItem(serverItem) as SupervisionItem);
      })
      .catch((error) => {
        if (cancelled) return;
        setCaseFileError(error instanceof Error ? error.message : '加载事项详情失败');
      })
      .finally(() => {
        if (!cancelled) setCaseFileLoading(false);
      });
    return () => { cancelled = true; };
  }, [caseFileRecord]);

  const closeCaseFile = React.useCallback(() => {
    setCaseFileRecordId(null);
    setCaseFileItem(null);
    setCaseFileError('');
  }, []);

  React.useEffect(() => {
    if (!caseFileRecord) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeCaseFile();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [caseFileRecord, closeCaseFile]);

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
                      {canRejectAudit && (
                        <button
                          onClick={() => handleAudit(record.id, record.itemId, false)}
                          disabled={processingId === record.id}
                          className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          title="驳回"
                        >
                          <XCircle className="w-6 h-6" />
                        </button>
                      )}
                      {canApproveAudit && (
                        <button
                          onClick={() => handleAudit(record.id, record.itemId, true)}
                          disabled={processingId === record.id}
                          className="p-2 text-green-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-all"
                          title="通过"
                        >
                          <CheckCircle2 className="w-6 h-6" />
                        </button>
                      )}
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
                      <button
                        onClick={() => setCaseFileRecordId(record.id)}
                        className="flex items-center gap-1 text-sm font-bold text-blue-600 hover:text-blue-700 transition-colors"
                      >
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

      {/* ─── 完整案卷弹窗：展示事项内容、附件与办理时间线 ─── */}
      <AnimatePresence>
        {caseFileRecord && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
            onClick={closeCaseFile}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-bold text-slate-900 truncate">{caseFileRecord.itemTitle}</h3>
                    {caseFileItem && (
                      <span className={`shrink-0 px-2 py-0.5 rounded-md text-[11px] font-bold ${getItemStatusStyle(caseFileItem.effectiveStatus || caseFileItem.status)}`}>
                        {getItemStatusLabel(caseFileItem.effectiveStatus || caseFileItem.status)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    提交人: {caseFileRecord.submitter} · 提交时间: {caseFileRecord.submitTime}
                  </p>
                </div>
                <button
                  onClick={closeCaseFile}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                  title="关闭"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                {caseFileLoading && (
                  <div className="py-16 flex flex-col items-center justify-center text-slate-400">
                    <Loader2 className="w-8 h-8 animate-spin mb-3" />
                    <p className="text-sm">正在加载案卷…</p>
                  </div>
                )}

                {!caseFileLoading && caseFileError && (
                  <div className="py-12 flex flex-col items-center justify-center text-red-500">
                    <AlertCircle className="w-10 h-10 mb-3 opacity-60" />
                    <p className="text-sm font-medium">{caseFileError}</p>
                  </div>
                )}

                {!caseFileLoading && !caseFileError && caseFileItem && (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <CaseFileField label="责任人" value={caseFileItem.ownerNames?.length ? caseFileItem.ownerNames.join('、') : caseFileItem.ownerName || (caseFileItem.ownerIds?.length ? caseFileItem.ownerIds.join('、') : '—')} />
                      <CaseFileField label="跟进人" value={caseFileItem.followerNames?.length ? caseFileItem.followerNames.join('、') : caseFileItem.followerName || (caseFileItem.followerIds?.length ? caseFileItem.followerIds.join('、') : '—')} />
                      <CaseFileField label="类别" value={caseFileItem.category || '—'} />
                      <CaseFileField label="提出日期" value={caseFileItem.raiseDate ? formatDateTime(caseFileItem.raiseDate) : '—'} />
                      <CaseFileField label="要求完成日期" value={caseFileItem.requiredCompletionDate || caseFileItem.deadline || '—'} />
                      <CaseFileField label="当前进度" value={`${caseFileItem.progress ?? 0}%`} />
                    </div>

                    <div>
                      <p className="text-xs font-bold text-slate-400 uppercase mb-2">事项内容</p>
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                        {caseFileItem.content || '暂无内容'}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-slate-400 uppercase">附件 ({caseFileItem.attachments?.length || 0})</p>
                      </div>
                      {caseFileItem.attachments?.length ? (
                        <div className="space-y-2">
                          {caseFileItem.attachments.map((attachment) => (
                            <a
                              key={attachment.id}
                              href={attachment.url || undefined}
                              target="_blank"
                              rel="noreferrer"
                              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm transition-colors ${
                                attachment.url
                                  ? 'border-slate-100 bg-white hover:border-blue-200 hover:bg-blue-50/50 text-slate-700'
                                  : 'border-dashed border-slate-200 bg-slate-50 text-slate-400 pointer-events-none'
                              }`}
                              title={attachment.url ? '点击下载/预览' : '附件下载地址暂不可用'}
                            >
                              <Paperclip className="w-4 h-4 shrink-0 text-slate-400" />
                              <span className="truncate font-medium flex-1">{attachment.name}</span>
                              <span className="text-xs text-slate-400 shrink-0">{attachment.size}</span>
                              {attachment.uploadedAt && <span className="text-xs text-slate-400 shrink-0">{attachment.uploadedAt}</span>}
                              {attachment.url && <Download className="w-4 h-4 shrink-0 text-blue-500" />}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400 bg-slate-50 rounded-xl px-4 py-3 border border-dashed border-slate-200">该事项暂无附件</p>
                      )}
                    </div>

                    <div>
                      <p className="text-xs font-bold text-slate-400 uppercase mb-3">办理时间线</p>
                      <div className="space-y-3">
                        {[...caseFileItem.timeline].reverse().map((node) => (
                          <div key={node.id} className={`flex items-start gap-3 px-4 py-3 rounded-xl ${getCaseFileTimelineBg(node.type)}`}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-bold text-slate-600">{getCaseFileTimelineLabel(node.type)}</span>
                                <span className="text-xs text-slate-400">{node.user}</span>
                                <span className="text-xs text-slate-400 ml-auto shrink-0">{formatDateTime(node.timestamp)}</span>
                              </div>
                              {node.content && (
                                <p className="text-sm text-slate-600 leading-relaxed mt-1 whitespace-pre-wrap break-words">
                                  {node.type === 'URGE' ? formatUrgeTimelineContent(node.content) : node.content}
                                </p>
                              )}
                              {node.attachments && node.attachments.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {node.attachments.map((attachment) => attachment.url ? (
                                    <a
                                      key={attachment.id}
                                      href={attachment.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                                    >
                                      <Paperclip className="w-3 h-3" />
                                      {attachment.name}
                                    </a>
                                  ) : (
                                    <span key={attachment.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-dashed border-slate-200 text-xs text-slate-400">
                                      <Paperclip className="w-3 h-3" />
                                      {attachment.name}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </MainLayout>
  );
};

function CaseFileField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">{label}</p>
      <p className="text-sm font-medium text-slate-800 break-words">{value}</p>
    </div>
  );
}

function getCaseFileTimelineLabel(type: string): string {
  switch (type) {
    case 'CREATE': return '创建';
    case 'SIGN': return '签收';
    case 'FEEDBACK': return '反馈';
    case 'FOLLOWER_FEEDBACK': return '跟进反馈';
    case 'URGE': return '催办';
    case 'DELAY': return '延期';
    case 'STATUS': return '状态变更';
    case 'CHANGE': return '变更';
    case 'REJECT': return '驳回';
    case 'APPLY_COMPLETE': return '申请完成';
    case 'APPROVE': return '审批通过';
    case 'SHARE': return '共享';
    case 'DISABLE': return '废弃';
    case 'RESTART': return '重启';
    case 'SATISFIED': return '未按要求完成';
    default: return type || '记录';
  }
}

function getCaseFileTimelineBg(type: string): string {
  switch (type) {
    case 'SIGN':
    case 'APPLY_COMPLETE':
    case 'APPROVE':
    case 'RESTART': return 'bg-green-50';
    case 'FEEDBACK':
    case 'FOLLOWER_FEEDBACK':
    case 'SHARE': return 'bg-blue-50';
    case 'URGE':
    case 'REJECT': return 'bg-red-50';
    case 'DELAY': return 'bg-orange-50';
    case 'CHANGE': return 'bg-amber-50';
    case 'DISABLE': return 'bg-gray-50';
    case 'SATISFIED': return 'bg-yellow-50';
    default: return 'bg-slate-50';
  }
}

export default AuditPage;
