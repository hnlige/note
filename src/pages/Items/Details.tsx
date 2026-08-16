import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { MainLayout } from '../../components/Layout/MainLayout';
import { normalizeRemoteItem, useStore } from '../../store/useStore';
import { api, hasAuthToken } from '../../lib/api';
import { useToast } from '../../components/Common/Toast';
import { 
  ChevronLeft, 
  Calendar, 
  User, 
  Clock, 
  MessageSquare, 
  Zap, 
  Paperclip, 
  History,
  Send,
  MoreVertical,
  CheckCircle2,
  AlertCircle,
  Upload,
  PlusCircle,
  FileText,
  Info,
  Trash2,
  CheckSquare,
  X,
  Share2,
  Undo2,
  RotateCcw,
  ThumbsDown,
  Download,
  Eye,
  Loader2,
  ArrowRightLeft
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Drawer } from '../../components/Common/Drawer';
import { PaginationFooter } from '../../components/Common/PaginationFooter';
import { AllowedAction, Attachment, DeptNode, TimelineNode } from '../../types';
import { formatDate, getEffectiveItemStatus, getEffectiveStatusForUserIdentity, getItemSignOffStatus, getItemStatusLabel, getItemStatusStyle, getSignOffStatusLabel, getSignOffStatusStyle, getUserSubTaskForIdentity, isItemFollowerForUser, isItemOwnerForUser, isManualDateOnOrAfter, isValidManualDateInput, normalizeManualDateInput, todayDateString, updateUserSubTaskForIdentity, formatDateTime } from '../../lib/item-format';
import { canUseAllowedAction, getAssignedRoleIds } from '../../store/role-access';
import { getDetailBackNavigation, getDetailPageAuth, getMessageIdFromDetailState } from './detail-navigation';
import { paginateTimelineNodes, prepareTimelineNodes, TIMELINE_PAGE_SIZE_OPTIONS } from './detail-timeline-pagination';

// 根据部门ID查找部门名称
const findDeptName = (nodes: DeptNode[], deptId: string): string | null => {
  for (const node of nodes) {
    if (node.id === deptId) return node.name;
    if (node.children) {
      const found = findDeptName(node.children, deptId);
      if (found) return found;
    }
  }
  return null;
};

const ItemDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const store = useStore();
  const { showToast } = useToast();
  const { getItemById, currentUser, updateItem, addActivity, addLog, orgUsers, roles, urgeRecords, updateUrgeRecord, departments, setItems, urgeSubTask, disableSubTask, restartSubTask, markMessageRead } = store;
  const messageId = useMemo(() => getMessageIdFromDetailState(location.state), [location.state]);
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'missing' | 'denied'>(() =>
    hasAuthToken() ? 'loading' : 'ready'
  );
  const item = getItemById(id || '');
  const backNavigation = useMemo(() => getDetailBackNavigation(location.state), [location.state]);
  const itemPageAuth = useMemo(() => getDetailPageAuth(location.state), [location.state]);
  const updateItemForPage = (itemId: string, updates: Parameters<typeof updateItem>[1]) =>
    updateItem(itemId, updates, itemPageAuth);

  useEffect(() => {
    if (!id) {
      setDetailState('missing');
      return;
    }

    if (!hasAuthToken()) {
      setDetailState('ready');
      return;
    }

    let cancelled = false;
    setDetailState('loading');

    api.items.getById(id)
      .then((serverItem) => {
        if (cancelled) return;
        const normalizedItem = normalizeRemoteItem(serverItem);
        const nextItems = [
          ...useStore.getState().items.filter(existingItem => existingItem.id !== normalizedItem.id),
          { ...normalizedItem, timeline: Array.isArray(normalizedItem.timeline) ? normalizedItem.timeline : [] },
        ];
        setItems(nextItems);
        setDetailState('ready');
      })
      .catch((error: { status?: number }) => {
        if (cancelled) return;

        if (error?.status === 403) {
          setItems(useStore.getState().items.filter(existingItem => existingItem.id !== id));
          setDetailState('denied');
          return;
        }

        if (error?.status === 404) {
          setItems(useStore.getState().items.filter(existingItem => existingItem.id !== id));
          setDetailState('missing');
          return;
        }

        setDetailState(useStore.getState().getItemById(id) ? 'ready' : 'missing');
      });

    return () => {
      cancelled = true;
    };
  }, [id, setItems]);

  // 仅由消息入口进入且事项详情已成功加载时，才将对应消息标记为已读。
  useEffect(() => {
    if (messageId && detailState === 'ready') {
      void markMessageRead(messageId);
    }
  }, [detailState, markMessageRead, messageId]);

  // 构建责任人→部门名称映射
  const ownerDeptMap = useMemo(() => {
    const map: Record<string, string> = {};
    orgUsers.forEach(u => {
      if (u.deptId) {
        const name = findDeptName(departments, u.deptId);
        if (name) map[u.id] = name;
      }
    });
    return map;
  }, [orgUsers, departments]);

  // ─── Feedback State ───
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackFiles, setFeedbackFiles] = useState<File[]>([]);
  const feedbackFileRef = useRef<HTMLInputElement>(null);

  // ─── Urge Reply State ───
  const [urgeReplyText, setUrgeReplyText] = useState('');
  const [replyUrgeId, setReplyUrgeId] = useState<string | null>(null);

  // 获取当前事项未回复的催办记录（当前用户是接收人）
  const pendingUrges = useMemo(() => {
    if (!item) return [];
    return urgeRecords.filter(r => 
      r.itemId === item.id && 
      r.receiver === currentUser.name &&
      (r.status === 'UNREAD' || r.status === 'READ')
    );
  }, [urgeRecords, item, currentUser]);

  // ─── Urge State ───
  const [isUrgeOpen, setIsUrgeOpen] = useState(false);
  const [urgeContent, setUrgeContent] = useState('');
  const [urgeTargets, setUrgeTargets] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (searchParams.get('action') === 'urge') {
      setIsUrgeOpen(true);
    }
  }, [searchParams]);

  // ─── Change State ───
  const [isChangeOpen, setIsChangeOpen] = useState(false);
  const [changeContent, setChangeContent] = useState('');

  // ─── Delay / Restart State ───
  const [isDelayOpen, setIsDelayOpen] = useState(false);
  const [delayData, setDelayData] = useState({ reason: '', newDeadline: '' });
  const [isRestartOpen, setIsRestartOpen] = useState(false);
  const [restartDate, setRestartDate] = useState('');

  // ─── Disable State ───
  const [isDisableOpen, setIsDisableOpen] = useState(false);
  const [disableReason, setDisableReason] = useState('');

  // ─── Reject State ───
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [isApproveOpen, setIsApproveOpen] = useState(false);

  // ─── Sign State ───
  const [isSignOpen, setIsSignOpen] = useState(false);
  const [signPlannedDate, setSignPlannedDate] = useState('');

  // ─── Apply Complete State ───
  const [isApplyCompleteOpen, setIsApplyCompleteOpen] = useState(false);
  const [completeNote, setCompleteNote] = useState('');
  const [isUnsatisfiedOpen, setIsUnsatisfiedOpen] = useState(false);
  const [unsatisfiedNote, setUnsatisfiedNote] = useState('');

  // ─── Share State ───
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [shareSearch, setShareSearch] = useState('');
  const [shareSelected, setShareSelected] = useState<{ id: string; name: string }[]>([]);

  // ─── SubTask State ───
  const [isSubTaskOpen, setIsSubTaskOpen] = useState(false);
  const [subTaskData, setSubTaskData] = useState({ title: '', deadline: '', assignee: '' });
  // 详情页「责任人子任务」区域：当前选中的责任人（点击卡片后按该责任人过滤时间轴）
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);

  // ─── Timeline Pagination ───
  const [timelinePage, setTimelinePage] = useState(1);
  const [timelinePageSize, setTimelinePageSize] = useState<number>(TIMELINE_PAGE_SIZE_OPTIONS[0]);
  const timelineSectionRef = useRef<HTMLDivElement>(null);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Derived ───
  const isOwner = item ? isItemOwnerForUser(item, currentUser) : false;
  const isFollower = item ? isItemFollowerForUser(item, currentUser) : false;
  const isAdmin = currentUser.role === 'ADMIN';

  // 执行时间轴：去重 + 按时间倒序 + 按选中责任人过滤后，再做前端分页
  const timelineNodes = useMemo(
    () => prepareTimelineNodes(item?.timeline, selectedOwner),
    [item?.timeline, selectedOwner],
  );
  const timelinePagination = useMemo(
    () => paginateTimelineNodes(timelineNodes, timelinePage, timelinePageSize),
    [timelineNodes, timelinePage, timelinePageSize],
  );
  useEffect(() => {
    if (timelinePage !== timelinePagination.currentPage) {
      setTimelinePage(timelinePagination.currentPage);
    }
  }, [timelinePage, timelinePagination.currentPage]);
  useEffect(() => {
    setTimelinePage(1);
  }, [selectedOwner]);
  const handleTimelinePageChange = (nextPage: number) => {
    setTimelinePage(nextPage);
    // 翻页后把「执行时间轴」滚动到视口顶部，避免用户以为页面没变化。
    // scrollIntoView 在 jsdom 下不存在，因此加可选调用保护，仅在真实浏览器生效。
    timelineSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  const handleTimelinePageSizeChange = (nextPageSize: number) => {
    setTimelinePage(1);
    setTimelinePageSize(nextPageSize);
  };
  const followerSupervisorIds = useMemo(() => {
    if (!item) return [];
    const followerIds = [item.followerId, ...(item.followerIds || [])].filter(Boolean);
    return [...new Set(followerIds.flatMap((followerId) => {
      const follower = orgUsers.find(user => user.id === followerId);
      const supervisorId = follower?.supervisorId;
      const supervisor = supervisorId ? orgUsers.find(user => user.id === supervisorId && user.status === 'ACTIVE') : undefined;
      return supervisor ? [supervisor.id] : [];
    }))];
  }, [item, orgUsers]);
  const isFinalApprover = followerSupervisorIds.includes(currentUser.id);
  // 审批状态（逐子任务独立，互不干扰）：
  // - pendingFollowerApproval：存在「待审批完成」且尚未经本跟进人审批的子任务 → 跟进人显示「审批通过」
  // - pendingFinalApproval：存在「待审批完成」且已过跟进人本级、尚待上级终审的子任务 → 上级显示「终审审批通过」
  // - submittedToLeader：本跟进人已审批（存在其 followerApprovedBy 的子任务），等待上级终审
  const itemSubTasks = item?.subTasks || [];
  const isMultiSub = itemSubTasks.length > 1;
  const pendingFollowerApproval = isFollower && !isFinalApprover && itemSubTasks.some(
    (t: any) => t.status === 'REVIEWING' && !t.followerApprovedBy,
  );
  const pendingFinalApproval = (isFinalApprover || isAdmin) && itemSubTasks.some(
    (t: any) => t.status === 'REVIEWING' && t.followerApprovedBy && !t.finalApprovedBy,
  );
  const submittedToLeader = isFollower && !isFinalApprover && itemSubTasks.some(
    (t: any) => t.status === 'REVIEWING' && t.followerApprovedBy === currentUser.name && !t.finalApprovedBy,
  );
  // 兼容老数据/单责任人（无子任务）：沿用时间轴判定是否已审批
  const hasCurrentUserApproved = (item?.timeline || []).some(n => n.type === 'APPROVE' && n.user === currentUser.name);
  // 是否展示审批面板：多责任人按子任务独立判定；单责任人/老数据按时间轴判定
  const showApprovePanel = (isAdmin || isFollower || isFinalApprover) && (
    isMultiSub ? (pendingFollowerApproval || pendingFinalApproval) : !hasCurrentUserApproved
  );
  // 仅被分享查看、无任何事项角色关系的用户：只能查看，不能分享
  const isSharedViewerOnly = !isOwner && !isFollower && !isAdmin && Boolean(item?.sharedWith?.some(s => s.userId === currentUser.id));
  const normalizedIssuerIdentity = String(item?.issuerAccount || item?.issuerId || '').trim().toLowerCase();
  const currentIdentityKeys = [currentUser.id, currentUser.name, currentUser.username].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
  const currentOwnerSubTask = item ? getUserSubTaskForIdentity(item, currentUser) : undefined;
  // 签收时是否需要填写计划完成日期：只看子任务/事项的 plannedCompletionDate 是否为空。
  // 不再把 requiredCompletionDate（要求完成日期）算作已填——签收必须写入 plannedCompletionDate，
  // 否则子任务的计划完成日期会永久为空。
  const requiresPlannedDateOnSign = item
    ? (currentOwnerSubTask ? !currentOwnerSubTask.plannedCompletionDate : !item.plannedCompletionDate)
    : false;
  const canLegacyEdit = canUseAllowedAction(currentUser, roles, 'EDIT_ITEM');
  const canPerform = (action: AllowedAction) =>
    canLegacyEdit || canUseAllowedAction(currentUser, roles, action);
  const canDeleteByIssuerRule = Boolean(normalizedIssuerIdentity && currentIdentityKeys.includes(normalizedIssuerIdentity));
  const hasDeleteFallbackPrivilege = isAdmin || getAssignedRoleIds(currentUser).includes('r5');

  const activeUsers = useMemo(() => orgUsers.filter(u => u.status === 'ACTIVE'), [orgUsers]);
  const latestCompletionApplication = useMemo(
    () => [...(item?.timeline || [])].reverse().find(node => node.type === 'APPLY_COMPLETE'),
    [item?.timeline],
  );
  useEffect(() => {
    setAttachments(item?.attachments || []);
  }, [item?.id, item?.attachments]);

  const uploadAttachments = (itemId: string, files: File[]) =>
    Promise.all(files.map((file) => api.attachments.upload(itemId, file, itemPageAuth)));

  const getItemStatusUpdatesForCurrentOwner = (updates: Parameters<typeof updateUserSubTaskForIdentity>[2]) => {
    if (!item || !isOwner) return {};
    return updateUserSubTaskForIdentity(item, currentUser, updates);
  };

  // ─── Handlers ───

  const handleDeleteItem = () => {
    if (!item) return;
    if (confirm('确定将该督办事项移至回收站吗？30天内可从回收站找回。')) {
      store.deleteItem(item.id, itemPageAuth);
      addActivity({
        content: `${currentUser.name} 将【${item.title}】移至回收站`,
        type: 'STATUS_CHANGE'
      });
      addLog({ userName: currentUser.name, userId: currentUser.id, action: '事项删除', module: '督办事项' });
      navigate('/items');
    }
  };

  const handleFeedbackAttachmentUpload = async (files: FileList | null) => {
    if (!item || !files?.length) return;
    let uploadedAttachments: Attachment[];
    try {
      uploadedAttachments = await uploadAttachments(item.id, Array.from(files));
    } catch (error) {
      console.error('Upload feedback attachments error:', error);
      showToast('附件上传失败，请稍后重试', 'error');
      return;
    }
    const isFollowerFeedback = isFollower && !isOwner;
    const newNode = {
      id: 't' + Date.now(),
      type: isFollowerFeedback ? 'FOLLOWER_FEEDBACK' as const : 'FEEDBACK' as const,
      user: currentUser.name,
      content: `上传了附件：${uploadedAttachments.map(file => file.name).join('、')}`,
      timestamp: new Date().toISOString(),
      attachments: uploadedAttachments,
    };
    const saved = await updateItemForPage(item.id, {
      timeline: [...item.timeline, newNode],
      attachments: [...(item.attachments || []), ...uploadedAttachments],
      ...(!isFollowerFeedback ? { lastFeedbackDate: todayDateString() } : {}),
    });
    if (!saved) {
      showToast('附件上传失败，请稍后重试', 'error');
      return;
    }
    setFeedbackFiles([]);
    setAttachments(prev => [...prev, ...uploadedAttachments]);
    addActivity({ content: `${currentUser.name} 为【${item.title}】上传了反馈附件`, type: 'FEEDBACK' });
    showToast('附件已上传', 'success');
  };

  const handleFeedback = async () => {
    if (!item || !feedbackText.trim()) return;
    let feedbackAttachments: Attachment[];
    try {
      feedbackAttachments = await uploadAttachments(item.id, feedbackFiles);
    } catch (error) {
      console.error('Upload feedback attachments error:', error);
      showToast('附件上传失败，请稍后重试', 'error');
      return;
    }
    const isFollowerFeedback = isFollower && !isOwner;
    const newNode = {
      id: 't' + Date.now(),
      type: isFollowerFeedback ? 'FOLLOWER_FEEDBACK' as const : 'FEEDBACK' as const,
      user: currentUser.name,
      content: feedbackText,
      timestamp: new Date().toISOString(),
      attachments: feedbackAttachments,
    };
    const subTaskUpdates = isFollowerFeedback ? {} : getItemStatusUpdatesForCurrentOwner({
      status: item.status === 'PENDING' ? 'EXECUTING' : effectiveStatus === 'PENDING' ? 'EXECUTING' : effectiveStatus,
      lastFeedbackDate: todayDateString(),
      progress: Math.max(item.progress, 10),
    });
    const saved = await updateItemForPage(item.id, {
      ...(!isFollowerFeedback ? { status: item.status === 'PENDING' ? 'EXECUTING' : item.status } : {}),
      ...subTaskUpdates,
      timeline: [...item.timeline, newNode],
      ...(feedbackAttachments.length > 0 ? { attachments: [...(item.attachments || []), ...feedbackAttachments] } : {}),
      ...(!isFollowerFeedback ? { lastFeedbackDate: todayDateString() } : {}),
    });
    if (!saved) {
      showToast('反馈提交失败，请稍后重试', 'error');
      return;
    }
    addActivity({ content: `${currentUser.name} 提交了【${item.title}】的进度反馈`, type: 'FEEDBACK' });
    setFeedbackText('');
    setFeedbackFiles([]);
    showToast('反馈已提交', 'success');
  };

  const handleUrge = () => {
    if (!item || !urgeContent.trim() || urgeTargets.length === 0) return;
    urgeTargets.forEach(target => {
      store.addUrgeRecord({
        itemId: item.id,
        itemTitle: item.title,
        senderId: currentUser.id,
        sender: currentUser.name,
        receiverId: target.id,
        receiver: target.name,
        status: 'UNREAD',
        method: 'SYSTEM',
        content: urgeContent
      });
    });
    addActivity({
      content: `${currentUser.name} 对【${item.title}】进行了催办：${urgeContent}（催办对象：${urgeTargets.map(t => t.name).join('、')}）`,
      type: 'URGE'
    });
    // 将催办信息写入执行时间轴（详情页时间轴需展示催办记录），由后端按系统时间统一记录
    updateItem(item.id, {
      timeline: [...(item.timeline || []), {
        id: 't' + Date.now(),
        type: 'URGE' as const,
        user: currentUser.name,
        content: `【催办】${urgeContent}`,
        timestamp: new Date().toISOString(),
      }],
    }, 'MENU_ITEMS');
    setIsUrgeOpen(false);
    setUrgeContent('');
    setUrgeTargets([]);
    showToast('催办成功', 'success');
  };

  const handleUrgeReply = (urgeId: string) => {
    if (!urgeReplyText.trim() || !item) return;
    
    updateUrgeRecord(urgeId, {
      status: 'RESPONDED',
      responseContent: urgeReplyText
    });

    updateItemForPage(item.id, {
      timeline: [
        ...item.timeline,
        {
          id: 't' + Date.now(),
          type: 'FEEDBACK',
          user: currentUser.name,
          content: `【催办回复】${urgeReplyText}`,
          timestamp: new Date().toLocaleString()
        }
      ]
    });

    addActivity({
      content: `${currentUser.name} 回复了【${item.title}】的催办消息`,
      type: 'FEEDBACK'
    });

    setUrgeReplyText('');
    setReplyUrgeId(null);
  };

  const handleChange = () => {
    if (!item || !changeContent.trim()) return;
    const record = {
      id: 'ch' + Date.now(),
      user: currentUser.name,
      content: changeContent,
      timestamp: new Date().toLocaleString(),
      changes: [{ field: '事项内容', oldValue: '', newValue: changeContent }]
    };
    updateItemForPage(item.id, {
      changeHistory: [...(item.changeHistory || []), record],
      timeline: [...item.timeline, {
        id: 't' + Date.now(), type: 'CHANGE' as const, user: currentUser.name,
        content: `变更信息：${changeContent}`, timestamp: new Date().toLocaleString()
      }]
    });
    addLog({ userName: currentUser.name, userId: currentUser.id, action: '事项变更', module: '督办事项' });
    setIsChangeOpen(false);
    setChangeContent('');
  };

  const handleDelay = () => {
    if (!item || !delayData.reason || !delayData.newDeadline) return;
    const normalizedNewDeadline = normalizeManualDateInput(delayData.newDeadline);
    if (!isValidManualDateInput(normalizedNewDeadline)) {
      showToast('日期请按年/月/日格式输入，例如：2026/06/03', 'warning');
      return;
    }
    if (!isManualDateOnOrAfter(normalizedNewDeadline, todayDateString())) {
      showToast('日期不能早于今天', 'warning');
      return;
    }
    if (canApplyDelay) {
      const subTaskUpdates = getItemStatusUpdatesForCurrentOwner({
        status: 'DELAYED',
        deadline: delayData.newDeadline,
        plannedCompletionDate: delayData.newDeadline,
      });
      updateItemForPage(item.id, {
        ...subTaskUpdates,
        status: subTaskUpdates.status || 'DELAYED',
        deadline: delayData.newDeadline,
        plannedCompletionDate: delayData.newDeadline,
        timeline: [...item.timeline, {
          id: 't' + Date.now(),
          type: 'DELAY',
          user: currentUser.name,
          content: `申请延期。原因：${delayData.reason}，新计划完成日期：${normalizedNewDeadline}`,
          timestamp: new Date().toLocaleString(),
        }],
      });
      addLog({ userName: currentUser.name, userId: currentUser.id, action: '事项延期', module: '督办事项' });
    } else {
      store.delayItem(item.id, delayData.reason, delayData.newDeadline, itemPageAuth);
      addLog({ userName: currentUser.name, userId: currentUser.id, action: '事项暂缓', module: '督办事项' });
    }
    setIsDelayOpen(false);
    setDelayData({ reason: '', newDeadline: '' });
  };

  const handleRestart = () => {
    if (!item || !restartDate) return;
    const normalizedRestartDate = normalizeManualDateInput(restartDate);
    if (!isValidManualDateInput(normalizedRestartDate)) {
      showToast('新计划完成日期请按年/月/日格式输入，例如：2026/06/03', 'warning');
      return;
    }
    if (!isManualDateOnOrAfter(normalizedRestartDate, todayDateString())) {
      showToast('新计划完成日期不能早于今天', 'warning');
      return;
    }
    store.restartItem(item.id, normalizedRestartDate, undefined, itemPageAuth);
    addActivity({ content: `${currentUser.name} 重启了【${item.title}】，新截止日期：${normalizedRestartDate}`, type: 'STATUS_CHANGE' });
    addLog({ userName: currentUser.name, userId: currentUser.id, action: '事项重启', module: '督办事项' });
    setIsRestartOpen(false);
    setRestartDate('');
  };

  const handleDisable = () => {
    if (!item || !disableReason.trim()) return;
    store.disableItem(item.id, disableReason.trim(), itemPageAuth);
    addLog({ userName: currentUser.name, userId: currentUser.id, action: '事项废弃', module: '督办事项' });
    setIsDisableOpen(false);
    setDisableReason('');
  };

  const handleUndisable = () => {
    if (!item) return;
    if (!confirm('确定撤销废弃吗？撤销后事项状态将恢复到进行中。')) return;
    store.undisableItem(item.id, itemPageAuth);
    addLog({ userName: currentUser.name, userId: currentUser.id, action: '撤销废弃', module: '督办事项' });
  };

  const handleReject = () => {
    if (!item || !rejectReason.trim()) return;
    store.rejectItem(item.id, rejectReason.trim(), itemPageAuth);
    setIsRejectOpen(false);
    setRejectReason('');
  };

  const handleApplyComplete = async () => {
    if (!item) return;
    // 统一构造 APPLY_COMPLETE 时间轴节点，确保完成原因始终写入执行时间轴
    const newNode: TimelineNode = {
      id: 't' + Date.now(),
      type: 'APPLY_COMPLETE',
      user: currentUser.name,
      content: `申请完成：${completeNote}`,
      timestamp: new Date().toLocaleString(),
    };
    const subTaskUpdates = getItemStatusUpdatesForCurrentOwner({ status: 'REVIEWING', progress: 100 });
    const updates: Parameters<typeof updateItem>[1] = {
      ...subTaskUpdates,
      timeline: [...(item.timeline || []), newNode],
    };
    // 无子任务更新时（如责任人即事项负责人）仍需将事项置为待审批完成
    if (!updates.status) {
      updates.status = 'REVIEWING';
    }
    const saved = await updateItemForPage(item.id, updates);
    if (!saved) {
      showToast('完成申请提交失败，请稍后重试', 'error');
      return;
    }
    addActivity({ content: `${currentUser.name} 提交了【${item.title}】的完成申请`, type: 'STATUS_CHANGE' });
    addLog({ userName: currentUser.name, userId: currentUser.id, action: '申请完成', module: '督办事项' });
    showToast('完成申请已提交，已进入待审批', 'success');
    setIsApplyCompleteOpen(false);
    setCompleteNote('');
  };

  const handleApplyUnsatisfied = () => {
    if (!item) return;
    store.applyUnsatisfied(item.id, unsatisfiedNote, itemPageAuth);
    addActivity({ content: `${currentUser.name} 将【${item.title}】标记为「未按要求完成」`, type: 'STATUS_CHANGE' });
    setIsUnsatisfiedOpen(false);
    setUnsatisfiedNote('');
  };

  const handleApproveComplete = (approved: boolean) => {
    if (!item) return;
    const rejectReason = approved ? undefined : (prompt('请输入驳回原因：') || '审批未通过');
    store.approveComplete(item.id, approved, rejectReason, itemPageAuth)
      .then(() => {
        if (approved) {
          addActivity({ content: `${currentUser.name} 审批通过：【${item.title}】${isFinalApprover ? '已完成' : '已提交上级领导终审'}`, type: 'STATUS_CHANGE' });
          showToast(isFinalApprover ? '审批通过，事项已完成' : '审批通过，已提交上级领导终审', 'success');
        } else {
          showToast('审批驳回成功', 'success');
        }
        setIsApproveOpen(false);
      })
      .catch((e: any) => {
        if (e?.status === 409) {
          showToast(e?.message || '已有其他跟进人审批通过，等待上级终审', 'warning');
        } else {
          showToast(e?.message || '审批操作失败，请稍后重试', 'error');
        }
      });
  };

  const handleShare = async () => {
    if (!item || shareSelected.length === 0) return;
    await store.shareItem(item.id, shareSelected.map(s => ({
      userId: s.id, userName: s.name, sharedAt: new Date().toLocaleString(), sharedBy: currentUser.name
    })), itemPageAuth);
    addActivity({ content: `${currentUser.name} 将【${item.title}】共享给了：${shareSelected.map(s => s.name).join('、')}`, type: 'SYSTEM' });
    addLog({ userName: currentUser.name, userId: currentUser.id, action: '事项共享', module: '督办事项' });
    setIsShareOpen(false);
    setShareSelected([]);
  };

  const handleRevokeShare = async (userId: string, userName: string) => {
    if (!item) return;
    await store.revokeShareItem(item.id, userId, itemPageAuth);
    addActivity({ content: `${currentUser.name} 撤销了【${item.title}】对 ${userName} 的共享`, type: 'SYSTEM' });
    addLog({ userName: currentUser.name, userId: currentUser.id, action: '撤销事项共享', module: '督办事项' });
  };

  const handleSign = (plannedDate?: string) => {
    if (!item) return;
    const normalizedPlannedDate = plannedDate ? normalizeManualDateInput(plannedDate) : undefined;
    if (normalizedPlannedDate) {
      if (!isValidManualDateInput(normalizedPlannedDate)) {
        showToast('计划完成日期请按年/月/日格式输入，例如：2026/06/03', 'warning');
        return;
      }
      if (!isManualDateOnOrAfter(normalizedPlannedDate, todayDateString())) {
        showToast('计划完成日期不能早于今天', 'warning');
        return;
      }
    }
    const plannedDateUpdates = normalizedPlannedDate
      ? { plannedCompletionDate: normalizedPlannedDate, deadline: normalizedPlannedDate }
      : {};
    const subTaskUpdates = getItemStatusUpdatesForCurrentOwner({ status: 'EXECUTING', ...plannedDateUpdates });
    updateItemForPage(item.id, { ...plannedDateUpdates, ...subTaskUpdates, status: subTaskUpdates.status || 'EXECUTING', effectiveStatus: subTaskUpdates.status || 'EXECUTING', timeline: [...item.timeline, {
      id: 't' + Date.now(), type: 'SIGN' as const, user: currentUser.name,
      content: plannedDate ? `签收了该督办事项，计划完成日期：${plannedDate}` : '签收了该督办事项', timestamp: new Date().toLocaleString()
    }]});
    addActivity({ content: `${currentUser.name} 签收了督办事项：【${item.title}】`, type: 'STATUS_CHANGE' });
    setIsSignOpen(false);
    setSignPlannedDate('');
  };

  const handleSignClick = () => {
    if (requiresPlannedDateOnSign) {
      // 带出要求完成日期作为默认值（若有），便于责任人确认或调整后签收
      const defaultDate = currentOwnerSubTask?.requiredCompletionDate || item?.requiredCompletionDate || '';
      setSignPlannedDate(defaultDate);
      setIsSignOpen(true);
      return;
    }
    handleSign();
  };

  const handleSubTaskSubmit = async () => {
    if (!item || !subTaskData.title || !subTaskData.deadline) return;
    const newSubTask = { id: 'st' + Date.now(), title: subTaskData.title, deadline: subTaskData.deadline, status: 'PENDING' as const };
    const saved = await updateItemForPage(item.id, {
      subTasks: [...(item.subTasks || []), newSubTask],
      timeline: [...item.timeline, { id: 't' + Date.now(), type: 'CREATE', user: currentUser.name, content: `拆解了新子任务：${subTaskData.title}`, timestamp: new Date().toLocaleString() }]
    });
    if (!saved) {
      showToast('拆解子任务失败，请稍后重试', 'error');
      return;
    }
    setIsSubTaskOpen(false);
    setSubTaskData({ title: '', deadline: '', assignee: '' });
  };

  const toggleSubTask = async (stId: string) => {
    if (!item) return;
    const newSubTasks = item.subTasks?.map(st => st.id === stId ? { ...st, status: (st.status === 'PENDING' ? 'COMPLETED' as const : 'PENDING' as const) } : st);
    const saved = await updateItemForPage(item.id, { subTasks: newSubTasks });
    if (!saved) showToast('更新分解任务失败，请稍后重试', 'error');
  };

  const deleteSubTask = async (stId: string) => {
    if (!item) return;
    const saved = await updateItemForPage(item.id, { subTasks: item.subTasks?.filter(st => st.id !== stId) });
    if (!saved) showToast('删除分解任务失败，请稍后重试', 'error');
  };

  // ─── Status helpers ───
  const aggregateStatus = item ? getEffectiveItemStatus(item) : undefined;
  const effectiveStatus = item ? (isOwner ? getEffectiveStatusForUserIdentity(item, currentUser) : aggregateStatus) : undefined;
  const canSubmitFeedback = Boolean(
    item &&
    (effectiveStatus === 'EXECUTING' || effectiveStatus === 'DELAYED') &&
    ((isOwner && canPerform('FEEDBACK_ITEM')) || (isFollower && canPerform('CHANGE_ITEM')))
  );
  const canApplyDelay = Boolean(item && isOwner && effectiveStatus === 'OVERDUE' && canPerform('DELAY_ITEM'));
  const feedbackPlaceholder = isFollower ? '在此输入给责任人的反馈意见...' : '在此输入您的反馈或进展说明...';
  const feedbackButtonLabel = isFollower ? '反馈责任人' : '发送反馈';

  const getStatusStyle = (status: string) => {
    return getItemStatusStyle(status);
  };

  const getStatusLabel = (status: string) => {
    return getItemStatusLabel(status);
  };

  // ─── Action button matrix ───
  const getActionButtons = () => {
    if (!item) return [];

    const status = effectiveStatus || item.status;
    const buttons: { label: string; icon: React.ReactNode; onClick: () => void; color: string }[] = [];
    const activeStatuses = ['PENDING', 'EXECUTING', 'OVERDUE', 'DELAYED'];
    const finalStatuses = ['COMPLETED', 'ARCHIVED', 'DISABLED', 'NOT_SATISFIED', 'DELETED'];
    const canFollowOperate = isAdmin || isFollower;

    if (canPerform('URGE_ITEM') && canFollowOperate && activeStatuses.includes(status)) {
      buttons.push({ label: '催办', icon: <Zap className="w-4 h-4" />, onClick: () => setIsUrgeOpen(true), color: 'bg-orange-500 text-white' });
    }

    if (canPerform('CHANGE_ITEM') && canFollowOperate && activeStatuses.includes(status)) {
      buttons.push({ label: '变更', icon: <History className="w-4 h-4" />, onClick: () => setIsChangeOpen(true), color: 'bg-white text-slate-700 border border-slate-200' });
    }

    if (canPerform('SUSPEND_ITEM') && canFollowOperate && activeStatuses.includes(status)) {
        buttons.push({ label: '暂缓', icon: <Clock className="w-4 h-4" />, onClick: () => setIsDelayOpen(true), color: 'bg-white text-red-600 border border-red-200' });
    }

    if (canPerform('RESTART_ITEM') && canFollowOperate && status === 'SUSPENDED') {
      buttons.push({ label: '重启', icon: <RotateCcw className="w-4 h-4" />, onClick: () => setIsRestartOpen(true), color: 'bg-green-600 text-white' });
    }

    if (canApplyDelay) {
      buttons.push({ label: '申请延期', icon: <Clock className="w-4 h-4" />, onClick: () => setIsDelayOpen(true), color: 'bg-white text-orange-600 border border-orange-200' });
    }

    if (canPerform('DISABLE_ITEM') && canFollowOperate) {
      if (activeStatuses.includes(status) || status === 'SUSPENDED') {
        buttons.push({ label: '废弃', icon: <Trash2 className="w-4 h-4" />, onClick: () => setIsDisableOpen(true), color: 'bg-white text-red-600 border border-red-200' });
      } else if (status === 'DISABLED') {
        buttons.push({ label: '撤销废弃', icon: <Undo2 className="w-4 h-4" />, onClick: handleUndisable, color: 'bg-white text-amber-600 border border-amber-200' });
      }
    }

    if (canPerform('APPLY_COMPLETE_ITEM') && isOwner && (status === 'EXECUTING' || status === 'DELAYED')) {
      buttons.push({ label: '申请完成', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => setIsApplyCompleteOpen(true), color: 'bg-green-600 text-white' });
    }

    if (canPerform('APPLY_COMPLETE_ITEM') && canFollowOperate && (status === 'EXECUTING' || status === 'DELAYED')) {
      buttons.push({ label: '申请完成', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => setIsApplyCompleteOpen(true), color: 'bg-green-600 text-white' });
    }

    if (canPerform('MARK_UNSATISFIED_ITEM') && canFollowOperate && (status === 'EXECUTING' || status === 'OVERDUE' || status === 'DELAYED')) {
      buttons.push({ label: '未按要求完成', icon: <AlertCircle className="w-4 h-4" />, onClick: () => setIsUnsatisfiedOpen(true), color: 'bg-yellow-500 text-white' });
    }

    if (canPerform('SHARE_ITEM') && !finalStatuses.includes(status) && !isSharedViewerOnly) {
      buttons.push({ label: '共享', icon: <Share2 className="w-4 h-4" />, onClick: () => setIsShareOpen(true), color: 'bg-white text-slate-700 border border-slate-200' });
    }

    if (canPerform('DELETE_ITEM') && (canDeleteByIssuerRule || hasDeleteFallbackPrivilege) && canFollowOperate && (activeStatuses.includes(status) || status === 'SUSPENDED')) {
      buttons.push({ label: '删除', icon: <Trash2 className="w-4 h-4" />, onClick: handleDeleteItem, color: 'bg-white text-red-600 border border-red-200' });
    }

    return buttons;
  };

  if (detailState === 'loading') {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-[60vh]">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
          <h2 className="text-xl font-bold text-slate-900">正在加载督办事项</h2>
        </div>
      </MainLayout>
    );
  }

  if (detailState === 'denied') {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-[60vh]">
          <Eye className="w-16 h-16 text-slate-200 mb-4" />
          <h2 className="text-xl font-bold text-slate-900">当前账号无权查看该督办事项</h2>
          <button onClick={() => navigate(backNavigation.path)} className="mt-4 text-blue-600 font-semibold">{backNavigation.label}</button>
        </div>
      </MainLayout>
    );
  }

  if (detailState === 'missing' || !item) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-[60vh]">
          <AlertCircle className="w-16 h-16 text-slate-200 mb-4" />
          <h2 className="text-xl font-bold text-slate-900">未找到该督办事项</h2>
          <button onClick={() => navigate(backNavigation.path)} className="mt-4 text-blue-600 font-semibold">{backNavigation.label}</button>
        </div>
      </MainLayout>
    );
  }

  if (item.status === 'DELETED') {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-[60vh]">
          <Trash2 className="w-16 h-16 text-red-200 mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-1">此事项已在回收站中</h2>
          <p className="text-slate-500 text-sm mb-6">该督办事项已被删除，无法查看详情或进行操作。</p>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/items/recycle-bin')} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all">前往回收站</button>
            <button onClick={() => navigate(backNavigation.path)} className="px-4 py-2 bg-white text-slate-700 border border-slate-200 rounded-lg font-semibold hover:bg-slate-50 transition-all">{backNavigation.label}</button>
          </div>
        </div>
      </MainLayout>
    );
  }

  const actionButtons = getActionButtons();
  const shouldShowTitle = item.title && item.title !== item.serialNo;

  return (
    <MainLayout>
      <div className="mb-8">
        <button onClick={() => navigate(backNavigation.path)} className="flex items-center gap-1 text-slate-500 hover:text-slate-900 font-semibold transition-colors mb-4">
          <ChevronLeft className="w-4 h-4" />
          {backNavigation.label}
        </button>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {shouldShowTitle && <h1 className="text-2xl font-bold text-slate-900">{item.title}</h1>}
            <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${getStatusStyle(effectiveStatus || item.status)}`}>{getStatusLabel(effectiveStatus || item.status)}</span>
            {(() => {
              const so = item.signOffStatus
                ? { status: item.signOffStatus, signedCount: item.signedOwnerCount || 0, totalCount: item.totalOwnerCount || 0 }
                : getItemSignOffStatus(item);
              if (so.totalCount <= 1) return null;
              return (
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${getSignOffStatusStyle(so.status)}`}>
                  {getSignOffStatusLabel(so.status)} {so.signedCount}/{so.totalCount}
                </span>
              );
            })()}
          </div>
          <div className="flex items-center gap-2">
            {actionButtons.map((btn, i) => (
              <button key={i} onClick={btn.onClick} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all text-sm shadow-sm active:scale-95 ${btn.color}`}>
                {btn.icon}{btn.label}
              </button>
            ))}
            <button className="p-2 text-slate-400 hover:bg-white rounded-lg transition-all border border-transparent hover:border-slate-200">
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Side */}
        <div className="lg:col-span-1 space-y-6">
          {/* Basic Info */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-6">基本信息</h3>
            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0"><Calendar className="w-5 h-5" /></div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase mb-1">提出会议</p>
                  <p className="text-sm font-bold text-slate-900">{item.meetingName || '-'}</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0"><Clock className="w-5 h-5" /></div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase mb-1">提出时间</p>
                  <p className="text-sm font-bold text-slate-900">{formatDate(item.raiseDate)}</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0"><User className="w-5 h-5" /></div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase mb-1">责任人</p>
                  <div className="space-y-1">
                    {(() => {
                      // 优先使用 item.deptNames，否则根据 ownerId 从 ownerDeptMap 查找实际部门
                      const ownerIds = item.ownerIds?.length ? item.ownerIds : (item.ownerId ? [item.ownerId] : []);
                      const deptNamesFromMap = ownerIds.map(oid => ownerDeptMap[oid]).filter(Boolean);
                      const depts = item.deptNames?.length ? item.deptNames : (deptNamesFromMap.length ? deptNamesFromMap : ['-']);
                      const owners = item.ownerNames?.length ? item.ownerNames : (item.ownerName ? [item.ownerName] : ['-']);
                      const maxLen = Math.max(depts.length, owners.length);
                      return Array.from({ length: maxLen }, (_, i) => (
                        <p key={i} className="text-sm font-bold text-slate-900 flex items-center gap-2">
                          <span>{owners[i] || owners[0]}</span>{depts[i] && <><span className="text-slate-300">·</span><span>{depts[i]}</span></>}
                        </p>
                      ));
                    })()}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600 shrink-0"><Calendar className="w-5 h-5" /></div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase mb-0.5">要求完成日期</p>
                  <p className="text-sm font-bold text-red-600">{formatDate(item.requiredCompletionDate)}</p>
                  {item.restartDate && <p className="text-xs text-orange-500 mt-1">重启后新截止：{formatDate(item.restartDate)}</p>}
                </div>
              </div>
            </div>
            <div className="mt-8 pt-8 border-t border-slate-100">
              <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-sky-50 to-white px-5 py-5 sm:px-6">
                <h4 className="text-base sm:text-lg font-extrabold text-blue-900 tracking-wide mb-3">督办要求</h4>
                <p className="text-sm sm:text-[15px] text-slate-700 leading-7 whitespace-pre-wrap">{item.content}</p>
              </div>
            </div>
          </div>

          {/* Change History */}
          {(item.changeHistory?.length ?? 0) > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">变更信息</h3>
              <div className="space-y-3">
                {item.changeHistory?.slice().reverse().map(ch => (
                  <div key={ch.id} className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-amber-700">{ch.user}</span>
                      <span className="text-[10px] text-amber-400">{formatDateTime(ch.timestamp)}</span>
                    </div>
                    <p className="text-sm text-amber-800">{ch.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Shared Users */}
          {(item.sharedWith?.length ?? 0) > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">共享人员</h3>
              <div className="flex flex-wrap gap-2">
                {item.sharedWith?.map(su => (
                  <span key={su.userId} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-medium px-2 py-1 rounded-lg">
                    {su.userName}
                    {canPerform('SHARE_ITEM') && (isAdmin || isFollower) && (
                      <button
                        type="button"
                        onClick={() => handleRevokeShare(su.userId, su.userName)}
                        className="ml-1 text-blue-400 hover:text-red-500 transition-colors"
                        title="撤销共享"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 责任人子任务（多责任人自动拆分）：每位责任人一条独立子任务 */}
          {(item.subTasks?.length || 0) > 1 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">责任人子任务</h3>
                <div className="flex items-center gap-2">
                  {selectedOwner && (
                    <button
                      onClick={() => setSelectedOwner(null)}
                      className="text-xs px-2 py-1 rounded-lg bg-slate-100 text-slate-500 font-medium hover:bg-slate-200 transition-colors"
                    >清除筛选（{selectedOwner}）</button>
                  )}
                  <span className="text-xs font-bold text-slate-400">
                    {item.subTasks!.filter(t => t.status === 'COMPLETED' || t.status === 'ARCHIVED').length}/{item.subTasks!.length} 已完成
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                {item.subTasks!.map(st => {
                  const isMySub = currentOwnerSubTask?.id === st.id;
                  const canFollowerOperate = isFollower && !isOwner && st.status !== 'DELETED';
                  return (
                    <div
                      key={st.id}
                      onClick={() => setSelectedOwner((prev) => (prev === (st.assigneeName ?? null) ? null : (st.assigneeName ?? null)))}
                      className={`p-3 rounded-xl border transition-all cursor-pointer ${selectedOwner === st.assigneeName ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200' : isMySub ? 'bg-blue-50/60 border-blue-200' : 'bg-slate-50 border-transparent hover:bg-slate-100'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-medium px-2 py-0.5 rounded-lg shrink-0">{st.assigneeName || '未指定责任人'}</span>
                          {isMySub && <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">我的子任务</span>}
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${getItemStatusStyle(st.status)}`}>{getItemStatusLabel(st.status)}</span>
                        </div>
                        <span className="text-xs text-slate-400 shrink-0">进度 {st.progress ?? 0}%</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>计划完成：<b className="text-slate-700 font-medium">{formatDate(st.plannedCompletionDate || st.deadline)}</b></span>
                        {st.requiredCompletionDate && <span>要求完成：<b className="text-slate-700 font-medium">{formatDate(st.requiredCompletionDate)}</b></span>}
                        {st.actualCompletionDate && <span>实际完成：<b className="text-slate-700 font-medium">{formatDate(st.actualCompletionDate)}</b></span>}
                      </div>
                      {canFollowerOperate && (
                        <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              const content = window.prompt('催办内容', '请尽快处理您负责的子任务');
                              if (content) urgeSubTask(item.id, item.title, st, content);
                            }}
                            className="text-xs px-2.5 py-1 rounded-lg bg-orange-50 text-orange-600 font-semibold hover:bg-orange-100"
                          >催办此人</button>
                          {st.status !== 'DISABLED' && st.status !== 'COMPLETED' && st.status !== 'ARCHIVED' && (
                            <button
                              onClick={() => { if (window.confirm(`确认废弃 ${st.assigneeName} 负责的子任务？该操作不影响其他责任人与父级。`)) disableSubTask(item.id, st.id, '跟进人单独废弃', itemPageAuth); }}
                              className="text-xs px-2.5 py-1 rounded-lg bg-red-50 text-red-600 font-semibold hover:bg-red-100"
                            >废弃此子任务</button>
                          )}
                          {st.status === 'DISABLED' && (
                            <button
                              onClick={() => restartSubTask(item.id, st.id, itemPageAuth)}
                              className="text-xs px-2.5 py-1 rounded-lg bg-green-50 text-green-600 font-semibold hover:bg-green-100"
                            >重启此子任务</button>
                          )}
                        </div>
                      )}
                      {isOwner && !isMySub && (
                        <p className="mt-2 text-xs text-slate-400">该子任务由 {st.assigneeName} 负责，您仅可操作自己负责的子任务。</p>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] text-slate-400">父级操作（顶部按钮）将同步所有子任务；跟进人亦可单独操作单条子任务。</p>
            </div>
          )}

          {/* SubTasks（手动分解，仅单责任人事项展示） */}
          {(item.subTasks?.length || 0) <= 1 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">分解任务</h3>
              <span className="text-xs font-bold text-slate-400">{item.subTasks?.length || 0} 个</span>
            </div>
            <div className="space-y-3">
              {item.subTasks?.map(st => (
                <div key={st.id} className="group flex items-center justify-between p-3 bg-slate-50 rounded-xl hover:bg-white border border-transparent hover:border-slate-100 transition-all">
                  <div className="flex items-center gap-3">
                    <button onClick={() => toggleSubTask(st.id)} className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${st.status === 'COMPLETED' ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-slate-300 text-transparent'}`}>
                      <CheckSquare className="w-3.5 h-3.5" />
                    </button>
                    <div>
                      <p className={`text-sm font-bold ${st.status === 'COMPLETED' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{st.title}</p>
                      <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">{formatDate(st.deadline)}</p>
                    </div>
                  </div>
                  <button onClick={() => deleteSubTask(st.id)} className="p-1.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              {(!item.subTasks || item.subTasks.length === 0) && <p className="text-xs text-slate-400 text-center py-4 italic">暂未分解子任务</p>}
            </div>
          </div>
          )}

          {/* Attachments - 暂时隐藏相关附件展示区 */}
        </div>

        {/* Right Side: Timeline */}
        <div className="lg:col-span-2 space-y-6">
          <div ref={timelineSectionRef} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><History className="w-5 h-5 text-blue-600" />执行时间轴</h3>
              {selectedOwner && (
                <button
                  onClick={() => setSelectedOwner(null)}
                  className="text-xs px-2.5 py-1 rounded-lg bg-blue-100 text-blue-700 font-medium hover:bg-blue-200 transition-colors flex items-center gap-1"
                >仅看 {selectedOwner} 的反馈 · 清除筛选</button>
              )}
            </div>
            <div className="relative space-y-12">
              <div className="absolute left-6 top-2 bottom-2 w-0.5 bg-slate-50" />
              {timelinePagination.rows.map((node, index) => (
                <motion.div
                  key={`${node.id}-${node.timestamp}-${index}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  // 单页最多 50 条时逐条 0.1s 会累计到 5s，将延迟封顶避免用户误以为页面卡住
                  transition={{ delay: Math.min(index * 0.05, 0.4) }}
                  className="relative flex gap-8 pl-14"
                >
                  <div className={`absolute left-0 w-12 h-12 rounded-2xl ${getTimelineBg(node.type)} border-4 border-white shadow-sm flex items-center justify-center z-10`}>{getTimelineIcon(node.type)}</div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">{node.user}</span>
                        <span className="text-[10px] font-bold text-slate-400 px-1.5 py-0.5 bg-slate-50 rounded">{getTimelineTypeLabel(node.type)}</span>
                      </div>
                      <span className="text-xs font-medium text-slate-400">{formatDateTime(node.timestamp)}</span>
                    </div>
                    <div className="bg-slate-50/50 rounded-2xl p-4 border border-slate-50">
                      <p className="text-sm text-slate-700 leading-relaxed">{node.content}</p>
                      {node.attachments?.map((att, i) => (
                        <div key={i} className="mt-2 inline-flex items-center gap-2 bg-white px-2 py-1 rounded-lg text-xs text-blue-600 border border-blue-100">
                          <FileText className="w-3 h-3" />
                          <span>{att.name}</span>
                          {att.url && (
                            <a href={att.url} download={att.name} onClick={(e) => e.stopPropagation()} className="text-green-700 hover:underline">下载</a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              ))}
              {timelineNodes.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-4 italic pl-14">
                  {selectedOwner ? '该责任人暂无相关反馈记录。' : '暂无执行记录。'}
                </p>
              )}
            </div>

            {timelineNodes.length > 0 && (
              <div className="mt-8 -mx-8">
                <PaginationFooter
                  totalItems={timelineNodes.length}
                  currentPage={timelinePagination.currentPage}
                  totalPages={timelinePagination.totalPages}
                  pageSize={timelinePageSize}
                  pageSizeOptions={TIMELINE_PAGE_SIZE_OPTIONS}
                  itemLabel="条记录"
                  onPageChange={handleTimelinePageChange}
                  onPageSizeChange={handleTimelinePageSizeChange}
                />
              </div>
            )}

            {/* Urge Reply - 催办回复（责任人看到未回复的催办时显示） */}
            {pendingUrges.length > 0 && isOwner && (
              <div className="mt-12 pt-8 border-t border-slate-100">
                <div className="bg-red-50 border border-red-200 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                      <Zap className="w-5 h-5 text-red-600" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-red-800">收到 {pendingUrges.length} 条催办，请尽快回复</h4>
                      <p className="text-xs text-red-600">跟进人对您负责的事项发起了催办，请回复进展说明。</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {pendingUrges.map(urge => (
                      <div key={urge.id} className="bg-white rounded-xl p-4 border border-red-100">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded">来自：{urge.sender}</span>
                            <span className="text-xs text-slate-400">{formatDateTime(urge.timestamp)}</span>
                          </div>
                          <span className="text-xs font-medium text-slate-500">{urge.method === 'PHONE' ? '电话催办' : urge.method === 'MESSAGE' ? '短消息' : '系统提示'}</span>
                        </div>
                        {replyUrgeId === urge.id ? (
                          <div className="space-y-3">
                            <textarea
                              rows={3}
                              placeholder="请输入催办回复内容..."
                              className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all resize-none text-sm"
                              value={urgeReplyText}
                              onChange={(e) => setUrgeReplyText(e.target.value)}
                              autoFocus
                            />
                            <div className="flex items-center gap-2 justify-end">
                              <button
                                onClick={() => { setReplyUrgeId(null); setUrgeReplyText(''); }}
                                className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
                              >
                                取消
                              </button>
                              <button
                                onClick={() => handleUrgeReply(urge.id)}
                                disabled={!urgeReplyText.trim()}
                                className="px-4 py-1.5 text-xs font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all disabled:opacity-50"
                              >
                                <Send className="w-3 h-3 inline mr-1" />回复
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <p className="text-sm text-slate-700 flex-1 mr-4">
                              催办方式：{urge.method === 'PHONE' ? '电话催办' : urge.method === 'MESSAGE' ? '短消息' : '系统提示'}
                            </p>
                            <button
                              onClick={() => setReplyUrgeId(urge.id)}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-all shrink-0"
                            >
                              <MessageSquare className="w-3 h-3" />回复
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {effectiveStatus === 'PENDING' && canPerform('SIGN_ITEM') && isOwner && (
              <div className="mt-12 pt-8 border-t border-slate-100">
                <div className="flex items-center gap-3">
                  <button onClick={handleSignClick} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 transition-all text-sm shadow-sm active:scale-95"><CheckCircle2 className="w-4 h-4" />签收任务</button>
                </div>
              </div>
            )}

            {/* Feedback input — 责任人和督办专员在执行中/已延期时可见 */}
            {canSubmitFeedback && (
              <div className="mt-12 pt-8 border-t border-slate-100">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0"><User className="w-5 h-5" /></div>
                  <div className="flex-1">
                    <textarea 
                      placeholder={feedbackPlaceholder}
                      className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-4 pr-12 text-sm focus:ring-2 focus:ring-blue-500 transition-all resize-none min-h-[100px]"
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                    />
                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => feedbackFileRef.current?.click()} className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600 transition-colors">
                          <Paperclip className="w-4 h-4" />添加附件
                        </button>
                        <input ref={feedbackFileRef} type="file" multiple className="hidden" onChange={async (e) => {
                          await handleFeedbackAttachmentUpload(e.target.files);
                          e.target.value = '';
                        }} />
                        <span className="text-xs text-slate-400">选择后立即上传</span>
                      </div>
                      <button onClick={handleFeedback} disabled={!feedbackText.trim()} className="bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 shadow-md shadow-blue-100 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm font-bold">
                        <Send className="w-4 h-4" />{feedbackButtonLabel}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SUSPENDED - prompt restart */}
            {effectiveStatus === 'SUSPENDED' && (isAdmin || isFollower) && canPerform('RESTART_ITEM') && (
              <div className="mt-12 pt-8 border-t border-slate-100">
                <div className="bg-orange-50 border border-orange-200 rounded-2xl p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center shrink-0"><AlertCircle className="w-6 h-6 text-orange-600" /></div>
                    <div>
                      <h4 className="text-sm font-bold text-orange-800 mb-1">事项暂缓中</h4>
                      <p className="text-sm text-orange-600 mb-4">该事项处于暂缓状态。点击「重启」按钮填写新的计划完成日期以恢复执行。</p>
                      <button onClick={() => setIsRestartOpen(true)} className="flex items-center gap-2 bg-green-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-green-700 transition-all text-sm shadow-sm active:scale-95">
                        <RotateCcw className="w-4 h-4" />重启事项（必填新截止日期）
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* REVIEWING - approve/reject */}
            {effectiveStatus === 'REVIEWING' && showApprovePanel && (
              <div className="mt-12 pt-8 border-t border-slate-100">
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
                  <h4 className="text-sm font-bold text-amber-800 mb-2">待审批</h4>
                  <p className="text-sm text-amber-600 mb-4">此事项已申请完成，请审批是否通过。</p>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setIsApproveOpen(true)} className="flex items-center gap-2 bg-green-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-green-700 transition-all text-sm shadow-sm active:scale-95">
                      <CheckCircle2 className="w-4 h-4" />{pendingFinalApproval ? '终审审批通过' : '审批通过'}
                    </button>
                    <button onClick={() => setIsRejectOpen(true)} className="flex items-center gap-2 bg-white text-red-600 border border-red-200 px-6 py-2 rounded-lg font-bold hover:bg-red-50 transition-all text-sm active:scale-95">
                      <X className="w-4 h-4" />驳回
                    </button>
                  </div>
                </div>
              </div>
            )}

            {effectiveStatus === 'REVIEWING' && submittedToLeader && (
              <div className="mt-12 pt-8 border-t border-slate-100">
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6">
                  <h4 className="text-sm font-bold text-blue-800 mb-2">已提交上级领导终审</h4>
                  <p className="text-sm text-blue-600">您已完成本级审批，事项状态仍为“待审批完成”，等待上级领导终审。</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════ Drawers ═══════ */}

      {/* Sign Drawer */}
      <Drawer isOpen={isSignOpen} onClose={() => setIsSignOpen(false)} title="签收任务" footer={
        <div className="flex gap-3 justify-end">
          <button onClick={() => setIsSignOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
          <button onClick={() => handleSign(signPlannedDate)} disabled={!signPlannedDate} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all disabled:opacity-50">确认签收</button>
        </div>
      }>
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700">
            请填写计划完成日期后再签收。签收后事项将进入执行中，可继续提交反馈。
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">计划完成日期 <span className="text-red-500">*</span></label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="例如：2026/06/03"
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={signPlannedDate}
              onChange={(e) => setSignPlannedDate(e.target.value)}
              onBlur={(e) => setSignPlannedDate(normalizeManualDateInput(e.target.value))}
            />
            <p className="mt-1 text-xs text-slate-400">请按 {todayDateString()} 之后的年/月/日格式输入</p>
          </div>
        </div>
      </Drawer>

      {/* Urge Drawer */}
      <Drawer isOpen={isUrgeOpen} onClose={() => setIsUrgeOpen(false)} title="催办提醒" footer={
        <div className="flex gap-3 justify-end">
          <button onClick={() => setIsUrgeOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
          <button onClick={handleUrge} disabled={urgeTargets.length === 0 || !urgeContent.trim()} className="px-6 py-2 bg-orange-500 text-white rounded-lg font-semibold hover:bg-orange-600 transition-all disabled:opacity-50">发送催办</button>
        </div>
      }>
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">催办对象 <span className="text-red-500">*</span></label>
            <div className="border border-slate-200 rounded-xl p-4 max-h-48 overflow-y-auto space-y-2">
              <label className="flex items-center gap-2 text-sm font-bold text-blue-600 pb-2 border-b border-slate-100">
                <input type="checkbox" checked={urgeTargets.length === (item.ownerNames?.length || 1)} onChange={() => {
                  const all = (item.ownerNames || [item.ownerName]).filter(Boolean).map(n => ({ id: activeUsers.find(u => u.name === n)?.id || n, name: n }));
                  setUrgeTargets(urgeTargets.length === all.length ? [] : all);
                }} className="w-4 h-4 text-blue-600 rounded" />
                全选
              </label>
              {(item.ownerNames?.length ? item.ownerNames : item.ownerName ? [item.ownerName] : []).map(name => {
                const u = activeUsers.find(u => u.name === name);
                return (
                  <label key={name} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={urgeTargets.some(t => t.name === name)} onChange={() => {
                      setUrgeTargets(prev => prev.some(t => t.name === name) ? prev.filter(t => t.name !== name) : [...prev, { id: u?.id || name, name }]);
                    }} className="w-4 h-4 text-orange-500 rounded" />
                    {name} {u?.deptId ? `（${u.role}）` : ''}
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">催办内容 <span className="text-red-500">*</span></label>
            <textarea rows={4} placeholder="请输入催办说明..." className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none" value={urgeContent} onChange={(e) => setUrgeContent(e.target.value)} />
          </div>
        </div>
      </Drawer>

      <Drawer
        isOpen={isApproveOpen}
        onClose={() => setIsApproveOpen(false)}
        title="审批确认"
        footer={
          <div className="flex gap-3 justify-end">
            <button onClick={() => setIsApproveOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
            <button onClick={() => handleApproveComplete(true)} className="px-6 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-all">确定</button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-1">申请人</p>
              <p className="font-semibold text-slate-900">{latestCompletionApplication?.user || item?.ownerName}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-1">申请时间</p>
              <p className="font-semibold text-slate-900">{formatDateTime(latestCompletionApplication?.timestamp)}</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-1">完成说明</p>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {latestCompletionApplication?.content || '未提供完成说明'}
            </div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {pendingFinalApproval || isFinalApprover ? '确认终审通过后，对应子任务将变更为“已正常完成”。' : '确认通过后，将提交上级领导终审，对应子任务状态仍保持“待审批完成”。'}
          </div>
        </div>
      </Drawer>

      {/* Change Drawer */}
      <Drawer isOpen={isChangeOpen} onClose={() => setIsChangeOpen(false)} title="事项变更" footer={
        <div className="flex gap-3 justify-end">
          <button onClick={() => setIsChangeOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
          <button onClick={handleChange} disabled={!changeContent.trim()} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all disabled:opacity-50">提交变更</button>
        </div>
      }>
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-700">
            变更记录将保存在「变更信息」中，所有变更历史均可追溯查看。
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">变更内容说明 <span className="text-red-500">*</span></label>
            <textarea rows={5} placeholder="请详细描述变更的内容及原因..." className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none" value={changeContent} onChange={(e) => setChangeContent(e.target.value)} />
          </div>
        </div>
      </Drawer>

      {/* Delay Drawer */}
      <Drawer
        isOpen={isDelayOpen}
        onClose={() => setIsDelayOpen(false)}
        title={canApplyDelay ? '申请延期' : '暂缓事项'}
        footer={
        <div className="flex gap-3 justify-end">
          <button onClick={() => setIsDelayOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
          <button onClick={handleDelay} disabled={!delayData.reason || !delayData.newDeadline} className="px-6 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-all disabled:opacity-50">
            {canApplyDelay ? '确认延期' : '确认暂缓'}
          </button>
        </div>
      }>
        <div className="space-y-6">
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">
            {canApplyDelay
              ? '延期后事项恢复反馈入口，并按新的计划完成日期继续校验。'
              : '暂缓后事项将停止反馈、计时和提醒。需要重启时点击「重启」按钮并填写新的计划完成日期。'}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {canApplyDelay ? '新计划完成日期' : '预计重启日期'} <span className="text-red-500">*</span>
            </label>
            <input type="text" inputMode="numeric" placeholder="例如：2026/06/03" className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" value={delayData.newDeadline} onChange={(e) => setDelayData({ ...delayData, newDeadline: e.target.value })} onBlur={(e) => setDelayData({ ...delayData, newDeadline: normalizeManualDateInput(e.target.value) })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {canApplyDelay ? '延期原因' : '暂缓原因'} <span className="text-red-500">*</span>
            </label>
            <textarea rows={4} placeholder={canApplyDelay ? '请详细说明延期原因...' : '请详细说明暂缓原因...'} className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none" value={delayData.reason} onChange={(e) => setDelayData({ ...delayData, reason: e.target.value })} />
          </div>
        </div>
      </Drawer>

      {/* Restart Drawer */}
      <Drawer isOpen={isRestartOpen} onClose={() => setIsRestartOpen(false)} title="重启事项" footer={
        <div className="flex gap-3 justify-end">
          <button onClick={() => setIsRestartOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
          <button onClick={handleRestart} disabled={!restartDate} className="px-6 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-all disabled:opacity-50">确认重启</button>
        </div>
      }>
        <div className="space-y-6">
          <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-sm text-green-700">
            重启后事项恢复「执行中」状态，按新的截止日期重新计算是否超期。
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">新计划完成日期 <span className="text-red-500">*</span></label>
            <input type="text" inputMode="numeric" placeholder="例如：2026/06/03" className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" value={restartDate} onChange={(e) => setRestartDate(e.target.value)} onBlur={(e) => setRestartDate(normalizeManualDateInput(e.target.value))} />
          </div>
        </div>
      </Drawer>

      {/* Disable Drawer */}
      <Drawer isOpen={isDisableOpen} onClose={() => setIsDisableOpen(false)} title="废弃事项" footer={
        <div className="flex gap-3 justify-end">
          <button onClick={() => setIsDisableOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
          <button onClick={handleDisable} disabled={!disableReason.trim()} className="px-6 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-all disabled:opacity-50">确认废弃</button>
        </div>
      }>
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">
            废弃后事项状态变为「已废弃」，可随时撤销废弃恢复正常状态。
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">废弃原因 <span className="text-red-500">*</span></label>
            <textarea rows={4} placeholder="请说明废弃的原因..." className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none" value={disableReason} onChange={(e) => setDisableReason(e.target.value)} />
          </div>
        </div>
      </Drawer>

      {/* Reject Drawer */}
      <Drawer isOpen={isRejectOpen} onClose={() => setIsRejectOpen(false)} title="驳回" footer={
        <div className="flex gap-3 justify-end">
          <button onClick={() => setIsRejectOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
          <button onClick={handleReject} disabled={!rejectReason.trim()} className="px-6 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-all disabled:opacity-50">确认驳回</button>
        </div>
      }>
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">
            驳回后事项状态回到「执行中」，需要补充完成后重新提交申请。
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">驳回原因 <span className="text-red-500">*</span></label>
            <textarea rows={4} placeholder="请说明驳回原因..." className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </div>
        </div>
      </Drawer>

      {/* Apply Complete Drawer */}
      <Drawer isOpen={isApplyCompleteOpen} onClose={() => setIsApplyCompleteOpen(false)} title="申请完成" footer={
        <div className="flex gap-3 justify-end">
          <button onClick={() => setIsApplyCompleteOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
          <button onClick={handleApplyComplete} className="px-6 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-all">提交申请</button>
        </div>
      }>
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-sm text-green-700">
            提交后事项进入「待审批」状态，由督办跟进人/上级领导审批。
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">完成说明</label>
            <textarea rows={4} placeholder="请说明完成情况..." className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none" value={completeNote} onChange={(e) => setCompleteNote(e.target.value)} />
          </div>
        </div>
      </Drawer>

      {/* Unsatisfied Drawer */}
      <Drawer isOpen={isUnsatisfiedOpen} onClose={() => setIsUnsatisfiedOpen(false)} title="未按要求完成" footer={
        <div className="flex gap-3 justify-end">
          <button onClick={() => setIsUnsatisfiedOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
          <button onClick={handleApplyUnsatisfied} className="px-6 py-2 bg-yellow-500 text-white rounded-lg font-semibold hover:bg-yellow-600 transition-all">确认完成</button>
        </div>
      }>
        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-4 text-sm text-yellow-700">
            标记为「未按要求完成」后，事项仍将标记为已完成状态，但会记录未满足要求的原因。
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">未满足要求说明</label>
            <textarea rows={4} placeholder="请说明哪些要求未被满足..." className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none" value={unsatisfiedNote} onChange={(e) => setUnsatisfiedNote(e.target.value)} />
          </div>
        </div>
      </Drawer>

      {/* Share Drawer */}
      <Drawer isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} title="共享事项" footer={
        <div className="flex gap-3 justify-end">
          <button onClick={() => setIsShareOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
          <button onClick={handleShare} disabled={shareSelected.length === 0} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all disabled:opacity-50">确认共享</button>
        </div>
      }>
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700">
            共享后，被共享人将可查看该事项的详细信息。权限仅为「查看」。
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">选择人员</label>
            <input 
              type="text" placeholder="搜索姓名..." 
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm mb-2"
              value={shareSearch} onChange={(e) => setShareSearch(e.target.value)}
            />
            <div className="border border-slate-200 rounded-xl max-h-48 overflow-y-auto space-y-1 p-1">
              {activeUsers.filter(u => u.name.includes(shareSearch) && u.id !== currentUser.id && u.id !== item.ownerId && !item.ownerIds?.includes(u.id) && u.id !== item.followerId && !item.followerIds?.includes(u.id) && !item.sharedWith?.some(shared => shared.userId === u.id))
                .map(u => (
                  <label key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 rounded-lg cursor-pointer text-sm">
                    <input type="checkbox" checked={shareSelected.some(s => s.id === u.id)} onChange={() => {
                      setShareSelected(prev => prev.some(s => s.id === u.id) ? prev.filter(s => s.id !== u.id) : [...prev, { id: u.id, name: u.name }]);
                    }} className="w-4 h-4 text-blue-600 rounded" />
                    {u.name} <span className="text-xs text-slate-400">{u.role}</span>
                  </label>
                ))}
              {activeUsers.filter(u => u.name.includes(shareSearch) && u.id !== currentUser.id && u.id !== item.ownerId && !item.ownerIds?.includes(u.id) && u.id !== item.followerId && !item.followerIds?.includes(u.id) && !item.sharedWith?.some(shared => shared.userId === u.id)).length === 0 && (
                <p className="text-xs text-slate-400 text-center py-4">无匹配人员</p>
              )}
            </div>
            {shareSelected.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {shareSelected.map(s => (
                  <span key={s.id} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-medium px-2 py-1 rounded-lg">{s.name}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </Drawer>

      {/* SubTask Drawer */}
      <Drawer isOpen={isSubTaskOpen} onClose={() => setIsSubTaskOpen(false)} title="拆解子任务" footer={
        <div className="flex gap-3 justify-end">
          <button onClick={() => setIsSubTaskOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
          <button onClick={handleSubTaskSubmit} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all">添加子任务</button>
        </div>
      }>
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">子任务名称</label>
            <input type="text" placeholder="如：完成第一阶段现场调研" className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" value={subTaskData.title} onChange={(e) => setSubTaskData({ ...subTaskData, title: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">完成时限</label>
            <input type="text" inputMode="numeric" placeholder="例如：2026/06/03" className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" value={subTaskData.deadline} onChange={(e) => setSubTaskData({ ...subTaskData, deadline: e.target.value })} onBlur={(e) => setSubTaskData({ ...subTaskData, deadline: normalizeManualDateInput(e.target.value) })} />
          </div>
        </div>
      </Drawer>
    </MainLayout>
  );
};

// ═══════ Helper functions ═══════
function getTimelineTypeLabel(type: string): string {
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
    case 'REASSIGN': return '转交';
    default: return type || '记录';
  }
}

function getTimelineIcon(type: string) {
  switch (type) {
    case 'CREATE': return <PlusCircle className="w-4 h-4 text-blue-600" />;
    case 'SIGN': return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    case 'FEEDBACK': return <MessageSquare className="w-4 h-4 text-blue-600" />;
    case 'FOLLOWER_FEEDBACK': return <MessageSquare className="w-4 h-4 text-indigo-600" />;
    case 'URGE': return <Zap className="w-4 h-4 text-red-600" />;
    case 'DELAY': return <Clock className="w-4 h-4 text-orange-600" />;
    case 'STATUS': return <History className="w-4 h-4 text-slate-600" />;
    case 'CHANGE': return <History className="w-4 h-4 text-amber-600" />;
    case 'REJECT': return <ThumbsDown className="w-4 h-4 text-red-600" />;
    case 'APPLY_COMPLETE': return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    case 'APPROVE': return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    case 'SHARE': return <Share2 className="w-4 h-4 text-blue-600" />;
    case 'DISABLE': return <Trash2 className="w-4 h-4 text-gray-600" />;
    case 'RESTART': return <RotateCcw className="w-4 h-4 text-green-600" />;
    case 'SATISFIED': return <AlertCircle className="w-4 h-4 text-yellow-600" />;
    case 'REASSIGN': return <ArrowRightLeft className="w-4 h-4 text-purple-600" />;
    default: return <Info className="w-4 h-4 text-slate-600" />;
  }
}

function getTimelineBg(type: string) {
  switch (type) {
    case 'CREATE': return 'bg-blue-50';
    case 'SIGN': return 'bg-green-50';
    case 'FEEDBACK':
    case 'FOLLOWER_FEEDBACK': return 'bg-blue-50';
    case 'URGE': return 'bg-red-50';
    case 'DELAY': return 'bg-orange-50';
    case 'CHANGE': return 'bg-amber-50';
    case 'REJECT': return 'bg-red-50';
    case 'APPLY_COMPLETE': return 'bg-green-50';
    case 'APPROVE': return 'bg-green-50';
    case 'SHARE': return 'bg-blue-50';
    case 'DISABLE': return 'bg-gray-50';
    case 'RESTART': return 'bg-green-50';
    case 'SATISFIED': return 'bg-yellow-50';
    case 'REASSIGN': return 'bg-purple-50';
    default: return 'bg-slate-50';
  }
}

export default ItemDetail;
