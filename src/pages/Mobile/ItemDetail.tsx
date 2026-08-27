import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { api } from '../../lib/api';
import { useToast } from '../../components/Common/Toast';
import {
  getEffectiveItemStatus,
  getEffectiveStatusForUserIdentity,
  isItemOwnerForUser,
  isItemFollowerForUser,
  getItemSignOffStatus,
  getUserSubTaskForIdentity,
  updateUserSubTaskForIdentity,
  normalizeManualDateInput,
  isManualDateOnOrAfter,
  todayDateString,
  formatDateTime,
} from '../../lib/item-format';
import { MobileLayout } from './Layout';
import { StatusBadge, LightBadge } from './components/StatusBadge';
import { RemainingDays } from './components/RemainingDays';
import { ErrorState } from './components/EmptyState';
import { FeedbackModal } from './components/modals/FeedbackModal';
import { ExtensionModal } from './components/modals/ExtensionModal';
import { CompleteModal } from './components/modals/CompleteModal';
import { UrgeModal } from './components/modals/UrgeModal';
import { SignModal } from './components/modals/SignModal';
import { ApprovalModal } from './components/modals/ApprovalModal';
import { getItemApprovalState } from '../../lib/item-approval';
import { canUsePageAction } from '../../store/role-access';
import type { SupervisionItem, TimelineNode, ItemStatus, Attachment } from '../../types';
import { ChevronLeft, Clock, Users, Eye, Paperclip, MessageCircle } from 'lucide-react';
import { buildMobileUrgeRequests } from '../../lib/mobile-urge';

type ModalType = 'feedback' | 'extension' | 'complete' | 'urge' | 'sign' | 'approval' | 'reject' | null;

/** 时间线节点图标映射 */
function timelineIcon(type: TimelineNode['type']): string {
  switch (type) {
    case 'FEEDBACK':
    case 'FOLLOWER_FEEDBACK': return '💬';
    case 'URGE': return '📢';
    case 'DELAY': return '⏰';
    case 'SIGN': return '✓';
    case 'APPLY_COMPLETE': return '📝';
    case 'APPROVE': return '✓';
    case 'REJECT': return '✕';
    case 'SUSPEND': return '⏸';
    case 'RESTART': return '▶';
    case 'DISABLE': return '⛔';
    case 'CREATE': return '✨';
    case 'CHANGE': return '✏️';
    case 'SHARE': return '🔗';
    default: return '•';
  }
}

export const MobileItemDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, orgUsers, roles, postponeItem, applyComplete, approveComplete, addLightRecord, clearLightRecord, syncItems } = useStore();
  const { showToast } = useToast();

  const [item, setItem] = useState<SupervisionItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalType>(null);

  // 从路由 state 读取预唤起操作（消息卡片/列表快捷操作携带）
  const pendingAction = (location.state as { action?: string } | null)?.action;

  const fetchDetail = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.items.getById(id);
      setItem(data);
    } catch (err: any) {
      setError(err?.message || '加载事项详情失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // 预唤起操作
  useEffect(() => {
    if (item && pendingAction) {
      if (pendingAction === '反馈进度') setModal('feedback');
      else if (pendingAction === '申请延期') setModal('extension');
      else if (pendingAction === '申请完成') setModal('complete');
      else if (pendingAction === '催办') setModal('urge');
      else if (pendingAction === '签收') setModal('sign');
      else if (pendingAction === '审批通过') setModal('approval');
      else if (pendingAction === '驳回') setModal('reject');
      // 清除 pendingAction 避免重复弹
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [item, pendingAction, navigate, location.pathname]);

  const status = item ? getEffectiveItemStatus(item) : 'PENDING';
  const isOwner = item ? isItemOwnerForUser(item, currentUser) : false;
  const isFollower = item ? isItemFollowerForUser(item, currentUser) : false;
  const personalStatus = item ? getEffectiveStatusForUserIdentity(item, currentUser) : status;
  // 多责任人时，责任人的操作和状态展示必须以本人子任务为准。
  // 父事项会因其他责任人签收而进入 EXECUTING，但当前责任人仍可能处于 PENDING。
  const displayStatus = isOwner ? personalStatus : status;
  const signOff = item ? getItemSignOffStatus(item) : null;
  const approvalState = item
    ? getItemApprovalState(item, currentUser, orgUsers)
    : { isFinalApprover: false, pendingFollowerApproval: false, pendingFinalApproval: false, submittedToLeader: false, showApprovePanel: false };
  const { isFinalApprover, pendingFollowerApproval, pendingFinalApproval, submittedToLeader, showApprovePanel } = approvalState;
  const canApprove = canUsePageAction(currentUser, roles, 'MENU_MY_ITEMS', 'APPROVE_ITEM');
  const canReject = canUsePageAction(currentUser, roles, 'MENU_MY_ITEMS', 'REJECT_ITEM');

  // 有要求完成日期时，责任人签收统一沿用该日期；只有未填写要求日期时才要求本人补填计划日期。
  const currentOwnerSubTask = item ? getUserSubTaskForIdentity(item, currentUser) : undefined;
  const requiredCompletionDate = currentOwnerSubTask?.requiredCompletionDate || item?.requiredCompletionDate || '';
  const requirePlannedDate = item
    ? !requiredCompletionDate && (currentOwnerSubTask ? !currentOwnerSubTask.plannedCompletionDate : !item.plannedCompletionDate)
    : false;

  // ─── 签收 ───
  const handleSign = async (plannedDate?: string) => {
    if (!item) return;
    if (requirePlannedDate && !plannedDate) {
      showToast('请填写计划完成日期后再签收', 'warning');
      return;
    }
    const normalizedPlannedDate = normalizeManualDateInput(plannedDate || requiredCompletionDate);
    if (requirePlannedDate && !isManualDateOnOrAfter(normalizedPlannedDate, todayDateString())) {
      showToast('计划完成日期不能早于今天', 'warning');
      return;
    }
    const subTaskUpdates = updateUserSubTaskForIdentity(item, currentUser, { status: 'EXECUTING' as ItemStatus, ...(normalizedPlannedDate ? { plannedCompletionDate: normalizedPlannedDate, deadline: normalizedPlannedDate } : {}) });
    const newNode: TimelineNode = {
      id: 't' + Date.now(),
      type: 'SIGN',
      user: currentUser.name,
      content: normalizedPlannedDate ? `签收了该督办事项，计划完成日期：${normalizedPlannedDate}` : '签收了该督办事项',
      timestamp: new Date().toISOString(),
    };
    try {
      await api.items.update(item.id, {
        ...(normalizedPlannedDate ? { plannedCompletionDate: normalizedPlannedDate, deadline: normalizedPlannedDate } : {}),
        ...subTaskUpdates,
        status: subTaskUpdates.status || 'EXECUTING',
        effectiveStatus: subTaskUpdates.status || 'EXECUTING',
        timeline: [...item.timeline, newNode],
      }, 'MENU_MY_ITEMS');
      showToast('签收成功', 'success');
      await fetchDetail();
      syncItems().catch(() => {});
    } catch (err: any) {
      showToast(err?.message || '签收失败', 'error');
    }
  };

  // ─── 反馈 ───
  const handleFeedback = async (payload: { content: string; progress: string; files: File[] }) => {
    if (!item) return;
    const isFollowerFeedback = isFollower && !isOwner;
    let uploadedAttachments: Attachment[] = [];
    try {
      uploadedAttachments = await Promise.all(
        payload.files.map((file) => api.attachments.upload(item.id, file, 'MENU_MY_ITEMS')),
      );
    } catch (err: any) {
      showToast(err?.message || '附件上传失败，请稍后重试', 'error');
      return;
    }
    const progress = payload.progress === 'COMPLETED'
      ? 100
      : payload.progress === 'NOT_START'
        ? 0
        : Math.max(item.progress || 0, 10);
    const newNode: TimelineNode = {
      id: 't' + Date.now(),
      type: isFollowerFeedback ? 'FOLLOWER_FEEDBACK' : 'FEEDBACK',
      user: currentUser.name,
      content: payload.content,
      timestamp: new Date().toISOString(),
      attachments: uploadedAttachments,
    };
    const subTaskUpdates = isFollowerFeedback ? {} : updateUserSubTaskForIdentity(item, currentUser, {
      status: personalStatus === 'PENDING' ? 'EXECUTING' : personalStatus,
      lastFeedbackDate: todayDateString(),
      progress,
    });
    try {
      await api.items.update(item.id, {
        ...(!isFollowerFeedback ? { status: item.status === 'PENDING' ? 'EXECUTING' : item.status } : {}),
        ...subTaskUpdates,
        timeline: [...item.timeline, newNode],
        ...(uploadedAttachments.length > 0 ? { attachments: [...(item.attachments || []), ...uploadedAttachments] } : {}),
        ...(!isFollowerFeedback ? { lastFeedbackDate: todayDateString() } : {}),
      }, 'MENU_MY_ITEMS');
      showToast('反馈提交成功', 'success');
      await fetchDetail();
      syncItems().catch(() => {});
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('超时') || msg.includes('OVERDUE') || personalStatus === 'OVERDUE') {
        showToast('已超时事项请先申请延期', 'error');
      } else {
        showToast(msg || '反馈提交失败', 'error');
      }
    }
  };

  // ─── 延期 ───
  const autoOpenFeedbackRef = React.useRef(false);
  const handleExtension = async (payload: { newDeadline: string; reason: string }) => {
    if (!item) return;
    const result = await postponeItem(item.id, payload.reason, payload.newDeadline, 'MENU_MY_ITEMS');
    if (result.ok) {
      // 超时事项延期成功后直接引导继续反馈，避免用户再手动找反馈入口。
      autoOpenFeedbackRef.current = true;
      showToast('延期申请已提交，请继续反馈进展', 'success');
    } else {
      showToast(result.error || '延期申请失败，请稍后重试', 'error');
    }
    await fetchDetail();
  };

  const closeExtensionModal = () => {
    setModal(null);
    if (autoOpenFeedbackRef.current) {
      autoOpenFeedbackRef.current = false;
      setModal('feedback');
    }
  };

  // ─── 申请完成 ───
  const handleComplete = async (payload: { note: string; files: File[] }) => {
    if (!item) return;
    let uploadedAttachments: Attachment[] = [];
    try {
      uploadedAttachments = await Promise.all(
        payload.files.map((file) => api.attachments.upload(item.id, file, 'MENU_MY_ITEMS')),
      );
    } catch (err: any) {
      showToast(err?.message || '附件上传失败，请稍后重试', 'error');
      return;
    }
    try {
      await applyComplete(item.id, payload.note, 'MENU_MY_ITEMS', uploadedAttachments);
      showToast('申请已提交，等待审批', 'success');
      await fetchDetail();
      syncItems().catch(() => {});
    } catch (err: any) {
      showToast(err?.message || '完成申请提交失败，请稍后重试', 'error');
    }
  };

  // ─── 审批 ───
  const handleApproval = async (approved: boolean, reason?: string) => {
    if (!item) return;
    try {
      await approveComplete(item.id, approved, reason, 'MENU_MY_ITEMS');
      if (approved) {
        showToast(isFinalApprover || pendingFinalApproval ? '终审通过，事项已完成' : '审批通过，已提交上级领导终审', 'success');
      } else {
        showToast('审批驳回成功', 'success');
      }
      await fetchDetail();
      syncItems().catch(() => {});
    } catch (err: any) {
      if (err?.status === 409) {
        showToast(err?.message || '已有其他跟进人审批通过，等待上级终审', 'warning');
      } else {
        showToast(err?.message || '审批操作失败，请稍后重试', 'error');
      }
      throw err;
    }
  };

  // ─── 催办 ───
  const handleUrge = async (payload: { receiverIds: string[]; content: string }) => {
    if (!item) return;
    const requests = buildMobileUrgeRequests(item.id, payload.receiverIds, payload.content);
    if (requests.length === 0) {
      showToast('请选择有效的催办接收人', 'warning');
      return;
    }
    try {
      // 后端催办接口会在事务内写入时间线，移动端不重复追加。
      const failures: string[] = [];
      for (const request of requests) {
        try {
          await api.urges.create(request);
        } catch (err: any) {
          failures.push(err?.message || '发送失败');
        }
      }
      const sentCount = requests.length - failures.length;
      if (sentCount === requests.length) {
        showToast('催办已发送', 'success');
      } else if (sentCount > 0) {
        showToast(`已发送 ${sentCount}/${requests.length} 条，${failures[0]}`, 'warning');
      } else {
        showToast(failures[0] || '催办失败', 'error');
        return;
      }
      await fetchDetail();
    } catch (err: any) {
      showToast(err?.message || '催办失败', 'error');
    }
  };

  // ─── 亮灯 ───
  const handleLight = async (color: 'RED' | 'YELLOW') => {
    if (!item) return;
    try {
      await addLightRecord({
        itemId: item.id,
        color,
        reason: '移动端手动设置',
        triggerMode: 'MANUAL',
        operatorName: currentUser.name,
      });
      showToast(color === 'RED' ? '已设置红灯' : '已设置黄灯', 'success');
      await fetchDetail();
    } catch (err: any) {
      showToast(err?.message || '亮灯失败', 'error');
    }
  };

  const handleClearLight = async () => {
    if (!item) return;
    try {
      await clearLightRecord(item.id);
      showToast('已清除亮灯', 'success');
      await fetchDetail();
    } catch (err: any) {
      showToast(err?.message || '清除失败', 'error');
    }
  };

  // ─── 底部按钮矩阵 ───
  const renderFooterButtons = () => {
    if (!item) return null;
    const buttons: { label: string; type: ModalType | 'light-red' | 'light-yellow' | 'light-clear' | 'view-archive'; primary?: boolean; danger?: boolean }[] = [];

    const canProcessApproval = status === 'REVIEWING' && showApprovePanel && canApprove && (pendingFollowerApproval || pendingFinalApproval);
    if (canProcessApproval) {
      buttons.push({ label: pendingFinalApproval ? '终审审批通过' : '审批通过', type: 'approval', primary: true });
      if (canReject) buttons.push({ label: '驳回', type: 'reject', danger: true });
    }

    if (isOwner && !canProcessApproval) {
      if (displayStatus === 'PENDING') {
        buttons.push({ label: '签收', type: 'sign', primary: true });
      } else if (displayStatus === 'EXECUTING') {
        buttons.push({ label: '反馈进度', type: 'feedback', primary: true });
        buttons.push({ label: '申请完成', type: 'complete' });
      } else if (displayStatus === 'OVERDUE') {
        buttons.push({ label: '申请延期', type: 'extension', primary: true });
      } else if (displayStatus === 'DELAYED') {
        buttons.push({ label: '反馈进度', type: 'feedback' });
        buttons.push({ label: '申请完成', type: 'complete', primary: true });
      } else if (displayStatus === 'REVIEWING') {
        if (showApprovePanel && canApprove && (pendingFollowerApproval || pendingFinalApproval)) {
          buttons.push({ label: pendingFinalApproval ? '终审审批通过' : '审批通过', type: 'approval', primary: true });
          if (canReject) buttons.push({ label: '驳回', type: 'reject', danger: true });
        } else {
          return (
            <div className="bg-amber-50 rounded-xl px-4 py-3 text-center">
              <p className="text-sm text-amber-700 font-bold">⏳ {submittedToLeader ? '已提交上级领导终审' : '等待审批中…'}</p>
            </div>
          );
        }
      } else if (displayStatus === 'COMPLETED' || displayStatus === 'ARCHIVED') {
        buttons.push({ label: '查看归档', type: 'view-archive' });
      }
    }

    if (isFollower && !isOwner && status !== 'REVIEWING' && status !== 'SUSPENDED' && status !== 'COMPLETED' && status !== 'ARCHIVED' && status !== 'DISABLED') {
      buttons.push({ label: '反馈进度', type: 'feedback', primary: true });
      buttons.push({ label: '催办', type: 'urge', primary: true });
    }

    if (buttons.length === 0) return null;

    return (
      <div className="flex gap-3">
        {buttons.map((btn, i) => (
          <button
            key={i}
            onClick={() => {
              if (btn.type === 'light-red') handleLight('RED');
              else if (btn.type === 'light-yellow') handleLight('YELLOW');
              else if (btn.type === 'light-clear') handleClearLight();
              else if (btn.type === 'view-archive') navigate('/m/supervision');
              else if (btn.type === 'approval' || btn.type === 'reject') setModal(btn.type);
              else setModal(btn.type as ModalType);
            }}
            className={`flex-1 h-11 rounded-xl text-sm font-bold transition-all active:scale-[0.98] ${
              btn.primary
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : btn.danger
                ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
                : 'bg-white text-blue-600 border border-blue-200'
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <MobileLayout title="事项详情">
        <div className="animate-pulse space-y-3">
          <div className="h-20 bg-slate-100 rounded-2xl" />
          <div className="h-40 bg-slate-100 rounded-2xl" />
          <div className="h-32 bg-slate-100 rounded-2xl" />
        </div>
      </MobileLayout>
    );
  }

  if (error || !item) {
    return (
      <MobileLayout title="事项详情">
        <ErrorState message={error || '事项不存在'} onRetry={fetchDetail} />
      </MobileLayout>
    );
  }

  const ownerLabel = item.ownerNames?.length ? item.ownerNames.join('、') : item.ownerName || '-';
  const followerLabel = item.followerNames?.length ? item.followerNames.join('、') : item.followerName || '-';

  return (
    <MobileLayout title={`事项详情`}>
      {/* 返回 + 编号 */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-xs text-slate-500 mb-3">
        <ChevronLeft className="w-4 h-4" /> 返回
      </button>

      {/* 状态区域 */}
      <div className={`rounded-2xl p-4 mb-4 ${
        displayStatus === 'OVERDUE' || displayStatus === 'DELAYED' || displayStatus === 'NOT_SATISFIED' ? 'bg-red-50' :
        displayStatus === 'COMPLETED' ? 'bg-green-50' :
        displayStatus === 'PENDING' || displayStatus === 'REVIEWING' ? 'bg-amber-50' :
        displayStatus === 'EXECUTING' ? 'bg-blue-50' : 'bg-slate-50'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <StatusBadge status={displayStatus} />
            <RemainingDays deadline={currentOwnerSubTask?.deadline || item.deadline} status={displayStatus} />
            <LightBadge lightStatus={item.lightStatus} />
          </div>
          {signOff && signOff.status === 'PARTIAL' && (
            <span className="text-[10px] text-slate-500 font-medium">{signOff.signedCount}/{signOff.totalCount} 已签</span>
          )}
        </div>
        <h2 className="text-base font-bold text-slate-800 mb-1">#{item.serialNo} {item.title}</h2>
        {item.content && <p className="text-xs text-slate-600 leading-relaxed mt-2">{item.content}</p>}
        {isOwner && personalStatus !== status && (
          <p className="text-[10px] text-slate-400 mt-2">个人视角状态：{personalStatus}</p>
        )}
      </div>

      {/* 基本信息 */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 mb-4 space-y-3">
        <div className="flex items-start gap-2 text-xs">
          <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="text-slate-400">要求完成日期：</span>
            <span className="text-slate-700 font-medium">{item.requiredCompletionDate || item.deadline?.split(' ')[0] || '-'}</span>
            {item.plannedCompletionDate && item.plannedCompletionDate !== item.requiredCompletionDate && (
              <span className="ml-2 text-slate-400">（计划 {item.plannedCompletionDate}）</span>
            )}
          </div>
        </div>
        <div className="flex items-start gap-2 text-xs">
          <Users className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="text-slate-400">责任人：</span>
            <span className="text-slate-700 font-medium">{ownerLabel}</span>
          </div>
        </div>
        <div className="flex items-start gap-2 text-xs">
          <Eye className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="text-slate-400">跟进人：</span>
            <span className="text-slate-700 font-medium">{followerLabel}</span>
          </div>
        </div>
        {item.category && (
          <div className="flex items-start gap-2 text-xs">
            <span className="text-slate-400 shrink-0">分类：</span>
            <span className="text-slate-700 font-medium">{item.category}</span>
          </div>
        )}
      </div>

      {/* 进度时间线 */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <MessageCircle className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-700">进度时间线</h3>
          <span className="text-[10px] text-slate-400">({item.timeline.length})</span>
        </div>
        {item.timeline.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">暂无记录</p>
        ) : (
          <div className="space-y-3">
            {[...item.timeline].reverse().map(node => (
              <div key={node.id} className="flex gap-2">
                <span className="text-base shrink-0">{timelineIcon(node.type)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-bold text-slate-700">{node.user}</span>
                    <span className="text-[10px] text-slate-400">{formatDateTime(node.timestamp)}</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed break-words">{node.content}</p>
                  {node.attachments && node.attachments.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {node.attachments.map(att => (
                        <a key={att.id} href={att.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                          <Paperclip className="w-3 h-3" /> {att.name}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 审批进度模块（REVIEWING 态显示） */}
      {status === 'REVIEWING' && item.subTasks && (
        <div className="bg-white rounded-2xl border border-slate-100 p-4 mb-4">
          <h3 className="text-sm font-bold text-slate-700 mb-3">审批进度</h3>
          <div className="space-y-3">
            {item.subTasks.map(st => (
              <div key={st.id} className="flex gap-2">
                <div className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${
                  st.finalApprovedBy ? 'bg-green-500' :
                  st.followerApprovedBy ? 'bg-green-400' :
                  'bg-slate-200'
                }`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700">{st.assigneeName || '-'}</span>
                    {st.followerApprovedBy && (
                      <span className="text-[10px] text-green-600">跟进人 {st.followerApprovedBy} 已通过</span>
                    )}
                  </div>
                  {!st.followerApprovedBy && <p className="text-[10px] text-slate-400">等待跟进人审批…</p>}
                  {st.followerApprovedBy && !st.finalApprovedBy && <p className="text-[10px] text-slate-400">等待领导终审…</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 附件列表 */}
      {item.attachments && item.attachments.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Paperclip className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-bold text-slate-700">附件</h3>
          </div>
          <div className="space-y-1.5">
            {item.attachments.map(att => (
              <a key={att.id} href={att.url} target="_blank" rel="noreferrer" className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 hover:bg-slate-100 transition-all">
                <span className="text-xs text-slate-600 truncate flex-1">{att.name}</span>
                <span className="text-[10px] text-slate-400 ml-2">{att.size}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 底部固定操作栏 */}
      {renderFooterButtons() && (
        <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t border-slate-100 p-4 z-30" style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom))' }}>
          {renderFooterButtons()}
        </div>
      )}

      {/* Modals */}
      <SignModal
        open={modal === 'sign'}
        requirePlannedDate={requirePlannedDate}
        requiredCompletionDate={requiredCompletionDate}
        onClose={() => setModal(null)}
        onSign={handleSign}
        onError={(message) => showToast(message, 'warning')}
      />
      <FeedbackModal open={modal === 'feedback'} currentUser={currentUser} onClose={() => setModal(null)} onSubmit={handleFeedback} />
      <ExtensionModal
        open={modal === 'extension'}
        item={item}
        deadline={currentOwnerSubTask?.plannedCompletionDate || currentOwnerSubTask?.deadline || item?.deadline}
        onClose={closeExtensionModal}
        onSubmit={handleExtension}
      />
      <CompleteModal open={modal === 'complete'} onClose={() => setModal(null)} onSubmit={handleComplete} />
      <UrgeModal
        open={modal === 'urge'}
        item={item}
        activeUsers={orgUsers}
        onClose={() => setModal(null)}
        onError={(message) => showToast(message, 'error')}
        onSubmit={handleUrge}
      />
      <ApprovalModal
        open={modal === 'approval'}
        mode="approve"
        finalApproval={isFinalApprover || pendingFinalApproval}
        onClose={() => setModal(null)}
        onSubmit={() => handleApproval(true)}
      />
      <ApprovalModal
        open={modal === 'reject'}
        mode="reject"
        finalApproval={isFinalApprover || pendingFinalApproval}
        onClose={() => setModal(null)}
        onSubmit={(reason) => handleApproval(false, reason)}
      />
    </MobileLayout>
  );
};

export default MobileItemDetail;
