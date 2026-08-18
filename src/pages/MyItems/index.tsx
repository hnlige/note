import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MainLayout } from '../../components/Layout/MainLayout';
import { useStore } from '../../store/useStore';
import { useToast } from '../../components/Common/Toast';
import { api } from '../../lib/api';
import { 
  ClipboardList, 
  CheckSquare, 
  Send, 
  Eye,
  User,
  Calendar,
  FileText,
  Zap,
  RefreshCw,
  UserCheck,
  Users,
  Paperclip,
  X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Drawer } from '../../components/Common/Drawer';
import { formatDate, getEffectiveStatusForUser, getItemStatusLabel, getUserSubTask, isManualDateOnOrAfter, isValidManualDateInput, normalizeManualDateInput, todayDateString, updateUserSubTask, compareItemsByRaiseDateDesc } from '../../lib/item-format';
import { canUseAllowedAction, mapRoleIdentityToUserRole } from '../../store/role-access';
import { buildMyItemsScope, filterMyItemsByStatus, getMyRoleScopedStatus, getTodoStatus, getVisibleMyItemsRoleTabs, MyItemsRoleTabKey, MyItemsStatusTabKey } from './my-items-scope';

type RoleTabKey = MyItemsRoleTabKey;
type TabKey = MyItemsStatusTabKey;

const MyItems: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { items, currentUser, updateItem, addLog, orgUsers, roles, approveComplete, rejectItem, syncItems } = useStore();
  const { showToast } = useToast();
  const [isItemsLoading, setIsItemsLoading] = useState(true);
  // 工作台首页卡片下钻带 role=<todo|owner|follower> 与 status=<PENDING|...> 参数，
  // 进入页面时据其定位到对应顶层页签与状态筛选；非法值回退到默认 todo / all。
  const validRoleTabs: RoleTabKey[] = ['todo', 'owner', 'follower'];
  const validStatusTabs: TabKey[] = ['all', 'PENDING', 'EXECUTING', 'OVERDUE', 'DELAYED', 'COMPLETED'];
  const initialRole = (searchParams.get('role') as RoleTabKey | null);
  const initialStatus = (searchParams.get('status') as TabKey | null);
  const [activeRoleTab, setActiveRoleTab] = useState<RoleTabKey>(
    initialRole && validRoleTabs.includes(initialRole) ? initialRole : 'todo',
  );
  const [activeTab, setActiveTab] = useState<TabKey>(
    initialStatus && validStatusTabs.includes(initialStatus) ? initialStatus : 'all',
  );
  const [feedbackDrawer, setFeedbackDrawer] = useState<{ open: boolean; itemId: string; itemTitle: string }>({ open: false, itemId: '', itemTitle: '' });
  const [feedbackContent, setFeedbackContent] = useState('');
  const [feedbackFiles, setFeedbackFiles] = useState<File[]>([]);
  const feedbackFileInputRef = useRef<HTMLInputElement>(null);
  const [signDrawer, setSignDrawer] = useState<{ open: boolean; itemId: string; itemTitle: string }>({ open: false, itemId: '', itemTitle: '' });
  const [signPlannedDate, setSignPlannedDate] = useState('');
  const canSignItem = useMemo(
    () => canUseAllowedAction(currentUser, roles, 'EDIT_ITEM') || canUseAllowedAction(currentUser, roles, 'SIGN_ITEM'),
    [currentUser, roles],
  );
  const canFeedbackItem = useMemo(
    () => canUseAllowedAction(currentUser, roles, 'EDIT_ITEM') || canUseAllowedAction(currentUser, roles, 'FEEDBACK_ITEM'),
    [currentUser, roles],
  );

  // 《我的督办》直接依赖最新的责任人/跟进人关系。进入页面时主动回读权威事项数据，
  // 不依赖 MainLayout 的并发启动同步，避免旧标签页或同步时序导致短暂/持续显示 0。
  useEffect(() => {
    let active = true;
    setIsItemsLoading(true);
    syncItems()
      .catch(() => {
        if (active) showToast('督办事项加载失败，请刷新页面重试', 'error');
      })
      .finally(() => {
        if (active) setIsItemsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser.id, syncItems, showToast]);

  const resetFeedbackDrawer = () => {
    setFeedbackDrawer({ open: false, itemId: '', itemTitle: '' });
    setFeedbackContent('');
    setFeedbackFiles([]);
  };

  const currentOrgUser = useMemo(
    () => orgUsers.find(u => u.id === currentUser.id),
    [orgUsers, currentUser.id],
  );

  const currentMyItemsUser = useMemo(
    () => ({ ...currentUser, username: currentOrgUser?.username || currentUser.username }),
    [currentOrgUser?.username, currentUser],
  );

  // 当前用户的角色类型（ADMIN / OWNER / FOLLOWER），决定顶层页签可见性
  const userRoleType = useMemo(
    () => mapRoleIdentityToUserRole(currentUser),
    [currentUser],
  );
  const visibleRoleTabs = useMemo(
    () => getVisibleMyItemsRoleTabs(userRoleType),
    [userRoleType],
  );

  // URL role 参数指定的页签若对当前用户不可见（如跟进人从 role=owner 下钻），
  // 回退到「我的待办」，避免空白页或越权展示。
  useEffect(() => {
    if (!visibleRoleTabs.includes(activeRoleTab)) {
      setActiveRoleTab('todo');
    }
  }, [visibleRoleTabs, activeRoleTab]);

  const myItemsScope = useMemo(
    () => buildMyItemsScope(items, currentMyItemsUser),
    [items, currentMyItemsUser],
  );

  const myTodoItems = myItemsScope.todoItems;
  const myOwnedItems = myItemsScope.ownedItems;
  const myFollowedItems = myItemsScope.followedItems;

  const roleScopedItems = useMemo(
    () => {
      if (activeRoleTab === 'todo') return myTodoItems;
      return activeRoleTab === 'owner' ? myOwnedItems : myFollowedItems;
    },
    [activeRoleTab, myTodoItems, myOwnedItems, myFollowedItems]
  );

  // 按角色 Tab + 状态 Tab 筛选
  // 「我的待办」tab 默认无状态子页签 UI（混合责任人+跟进人视角），
  // 但从工作台卡片下钻带 status 参数时仍按状态筛选（用 getTodoStatus 与 todoItems 口径一致）。
  const filteredItems = useMemo(() => {
    if (activeRoleTab === 'todo') {
      if (activeTab === 'all') return myTodoItems;
      return myTodoItems.filter(item => getTodoStatus(item, currentMyItemsUser) === activeTab);
    }
    return filterMyItemsByStatus(roleScopedItems, currentMyItemsUser, activeRoleTab, activeTab);
  }, [activeRoleTab, activeTab, currentMyItemsUser, roleScopedItems, myTodoItems]);

  // 按"提出时间"倒序排列（最新日期的在最上面）
  const sortedItems = useMemo(() => [...filteredItems].sort(compareItemsByRaiseDateDesc), [filteredItems]);

  // 签收时是否需要填写计划完成日期：只看 plannedCompletionDate 是否为空。
  // 不再把 requiredCompletionDate 算作已填——签收必须写入 plannedCompletionDate。
  const requiresPlannedDateOnSign = (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return false;
    const subTask = getUserSubTask(item, currentUser.id);
    if (subTask) return !subTask.plannedCompletionDate;
    return !item.plannedCompletionDate;
  };

  const handleSign = async (itemId: string, title: string, plannedDate?: string) => {
    const item = items.find(i => i.id === itemId);
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
    const subTaskUpdates = item ? updateUserSubTask(item, currentUser.id, { status: 'EXECUTING', ...plannedDateUpdates }) : {};
    const saved = await updateItem(itemId, {
      ...plannedDateUpdates,
      ...subTaskUpdates,
      status: subTaskUpdates.status || 'EXECUTING',
      effectiveStatus: subTaskUpdates.status || 'EXECUTING',
      timeline: item ? [...(item.timeline || []), {
        id: 't' + Date.now(),
        type: 'SIGN' as const,
        user: currentUser.name,
        content: plannedDate ? `签收了该督办事项，计划完成日期：${plannedDate}` : '签收了该督办事项',
        timestamp: new Date().toISOString(),
      }] : undefined,
    }, 'MENU_MY_ITEMS');
    if (!saved) {
      showToast('签收失败，请稍后重试', 'error');
      return;
    }
    addLog({
      userName: currentUser.name,
      userId: currentUser.id,
      action: `签收事项: ${title}`,
      module: '督办事项',
    });
    showToast('已签收该事项', 'success');
    setSignDrawer({ open: false, itemId: '', itemTitle: '' });
    setSignPlannedDate('');
  };

  const handleSignClick = (itemId: string, title: string) => {
    if (requiresPlannedDateOnSign(itemId)) {
      // 带出要求完成日期作为默认值（若有），便于确认或调整后签收
      const item = items.find(i => i.id === itemId);
      const subTask = item ? getUserSubTask(item, currentUser.id) : undefined;
      const defaultDate = subTask?.requiredCompletionDate || item?.requiredCompletionDate || '';
      setSignPlannedDate(defaultDate);
      setSignDrawer({ open: true, itemId, itemTitle: title });
      return;
    }
    handleSign(itemId, title);
  };

  // 审批通过（跟进人）：状态保持不变，提交上级领导终审
  const handleApprove = (itemId: string) => {
    approveComplete(itemId, true, undefined, 'MENU_MY_ITEMS')
      .then(() => {
        showToast('已审批通过，已提交上级领导终审', 'success');
      })
      .catch((e: any) => {
        if (e?.status === 409) {
          showToast(e?.message || '已有其他跟进人审批通过，等待上级终审', 'warning');
        } else {
          showToast(e?.message || '审批操作失败，请稍后重试', 'error');
        }
      });
  };

  // 驳回（跟进人）：状态回到执行中
  const handleReject = (itemId: string, title: string) => {
    const reason = window.prompt(`请输入对【${title}】的驳回原因：`) || '';
    if (!reason.trim()) {
      showToast('驳回原因不能为空', 'warning');
      return;
    }
    rejectItem(itemId, reason.trim(), 'MENU_MY_ITEMS');
    showToast('已驳回，事项回到执行中', 'success');
  };

  // 提交反馈
  const handleSubmitFeedback = async () => {
    if (!feedbackContent.trim()) return;
    const item = items.find(i => i.id === feedbackDrawer.itemId);
    if (!item) return;
    const currentStatus = item.status || 'PENDING';
    // 如果当前是 PENDING，则变为 EXECUTING；否则保持当前状态
    const newStatus = currentStatus === 'PENDING' ? 'EXECUTING' : currentStatus;
    let feedbackAttachments;
    try {
      feedbackAttachments = await Promise.all(
        feedbackFiles.map((file) => api.attachments.upload(item.id, file, 'MENU_MY_ITEMS')),
      );
    } catch (error) {
      console.error('Upload feedback attachments error:', error);
      showToast('附件上传失败，请稍后重试', 'error');
      return;
    }
    const effectiveOwnerStatus = getEffectiveStatusForUser(item, currentUser.id);
    const subTaskUpdates = updateUserSubTask(item, currentUser.id, {
      status: effectiveOwnerStatus === 'PENDING' ? 'EXECUTING' : effectiveOwnerStatus,
      lastFeedbackDate: todayDateString(),
      progress: Math.max(item.progress || 0, 10),
    });
    const saved = await updateItem(feedbackDrawer.itemId, {
      status: subTaskUpdates.status || newStatus,
      effectiveStatus: subTaskUpdates.status || newStatus,
      ...subTaskUpdates,
      lastFeedbackDate: todayDateString(),
      attachments: feedbackAttachments.length > 0 ? [...(item.attachments || []), ...feedbackAttachments] : item.attachments,
      timeline: [...(item.timeline || []), {
        id: 't' + Date.now(),
        type: 'FEEDBACK' as const,
        user: currentUser.name,
        content: feedbackContent.trim(),
        timestamp: new Date().toISOString(),
        attachments: feedbackAttachments,
      }],
    }, 'MENU_MY_ITEMS');
    if (!saved) {
      showToast('反馈提交失败，请稍后重试', 'error');
      return;
    }
    addLog({
      userName: currentUser.name,
      userId: currentUser.id,
      action: `提交反馈: ${feedbackDrawer.itemTitle}`,
      module: '督办事项',
    });
    showToast('反馈已提交', 'success');
    resetFeedbackDrawer();
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { color: string; text: string }> = {
      'PENDING': { color: 'bg-amber-50 text-amber-600 border-amber-200', text: '待签收' },
      'EXECUTING': { color: 'bg-blue-50 text-blue-600 border-blue-200', text: '执行中' },
      'OVERDUE': { color: 'bg-red-50 text-red-600 border-red-200', text: '已超时' },
      'DELAYED': { color: 'bg-orange-50 text-orange-600 border-orange-200', text: '已延期' },
      'SUSPENDED': { color: 'bg-gray-50 text-gray-600 border-gray-200', text: '已暂缓' },
      'COMPLETED': { color: 'bg-green-50 text-green-600 border-green-200', text: '已完成' },
      'ARCHIVED': { color: 'bg-purple-50 text-purple-600 border-purple-200', text: '已归档' },
    };
    return map[status] || { color: 'bg-slate-50 text-slate-600 border-slate-200', text: getItemStatusLabel(status) };
  };

  const getRoleScopedStatus = (item: typeof items[0]) =>
    getMyRoleScopedStatus(item, currentMyItemsUser, activeRoleTab);

  const roleTabMeta: Record<RoleTabKey, { label: string; icon: React.ElementType; count: number }> = {
    todo: { label: '我的待办', icon: ClipboardList, count: myTodoItems.length },
    owner: { label: '我负责的督办', icon: UserCheck, count: myOwnedItems.length },
    follower: { label: '我跟进的督办', icon: Users, count: myFollowedItems.length },
  };
  const roleTabs = visibleRoleTabs.map((key) => ({ key, ...roleTabMeta[key] }));

  const activeStatusCounts = activeRoleTab === 'owner'
    ? myItemsScope.ownerStatusCounts
    : myItemsScope.followerStatusCounts;

  const tabs = [
    { key: 'all' as TabKey, label: '全部', count: activeStatusCounts.all },
    { key: 'PENDING' as TabKey, label: '待签收', count: activeStatusCounts.PENDING },
    { key: 'EXECUTING' as TabKey, label: '执行中', count: activeStatusCounts.EXECUTING },
    { key: 'OVERDUE' as TabKey, label: '已超时', count: activeStatusCounts.OVERDUE },
    { key: 'DELAYED' as TabKey, label: '已延期', count: activeStatusCounts.DELAYED },
    { key: 'COMPLETED' as TabKey, label: '已完成', count: activeStatusCounts.COMPLETED },
  ];

  const showStatusTabs = activeRoleTab !== 'todo';

  if (isItemsLoading) {
    return (
      <MainLayout>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <RefreshCw className="w-8 h-8 text-blue-500 mx-auto mb-4 animate-spin" />
          <p className="text-slate-600 font-medium">正在加载最新督办事项...</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">我的督办</h1>
          <p className="text-slate-500 text-sm mt-1">签收、分办、协办与执行反馈</p>
        </div>
      </div>

      {/* 统计卡片（与顶层页签一致，按角色类型显示，可点击切换） */}
      {(() => {
        const accentStyles: Record<string, { iconBg: string; iconColor: string }> = {
          blue: { iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
          green: { iconBg: 'bg-green-50', iconColor: 'text-green-600' },
          indigo: { iconBg: 'bg-indigo-50', iconColor: 'text-indigo-600' },
        };
        const summaryCards = visibleRoleTabs.map((key) => {
          if (key === 'todo') return { key, label: '我的待办', count: myTodoItems.length, sub: `待签收 ${myItemsScope.todoStatusCounts.PENDING || 0} 项 · 超时 ${myItemsScope.todoStatusCounts.OVERDUE || 0} 项`, icon: ClipboardList, accent: 'blue' as const };
          if (key === 'owner') return { key, label: '我负责的', count: myOwnedItems.length, sub: `共 ${myItemsScope.ownerStatusCounts.COMPLETED} 项已完成`, icon: UserCheck, accent: 'green' as const };
          return { key, label: '我跟进的', count: myFollowedItems.length, sub: `共 ${myItemsScope.followerStatusCounts.COMPLETED} 项已完成`, icon: Users, accent: 'indigo' as const };
        });
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {summaryCards.map((card) => {
              const Icon = card.icon;
              const accent = accentStyles[card.accent];
              const active = activeRoleTab === card.key;
              return (
                <button
                  key={card.key}
                  onClick={() => { setActiveRoleTab(card.key); setActiveTab('all'); }}
                  className={`text-left bg-white rounded-xl border shadow-sm p-5 transition-all ${
                    active ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-100 hover:border-blue-200'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`p-2.5 ${accent.iconBg} rounded-lg`}>
                      <Icon className={`w-5 h-5 ${accent.iconColor}`} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{card.label}</p>
                    </div>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{card.count}</p>
                  <p className="text-xs text-slate-400 mt-1">{card.sub}</p>
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* 角色维度 Tab 切换 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {roleTabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => {
                setActiveRoleTab(tab.key);
                setActiveTab('all');
              }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                activeRoleTab === tab.key
                  ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-100'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-blue-200 hover:text-blue-600'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              <span className={`text-xs ${activeRoleTab === tab.key ? 'text-blue-100' : 'text-slate-400'}`}>({tab.count})</span>
            </button>
          );
        })}
      </div>

      {/* 状态 Tab 切换（仅「我负责的督办 / 我跟进的督办」显示；「我的待办」按需求无子状态页签） */}
      {showStatusTabs && (
        <div className="flex items-center gap-1 mb-4 bg-slate-100/50 rounded-xl p-1 w-fit">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                activeTab === tab.key
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={`ml-1.5 text-xs ${
                  activeTab === tab.key ? 'text-blue-400' : 'text-slate-400'
                }`}>({tab.count})</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 事项列表 */}
      <div className="space-y-3">
        {sortedItems.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
            <ClipboardList className="w-12 h-12 text-slate-200 mx-auto mb-4" />
            <p className="text-slate-400 font-medium">暂无相关督办事项</p>
            <p className="text-xs text-slate-300 mt-1">当前筛选条件下没有事项数据</p>
          </div>
        )}
        {sortedItems.map((item, index) => {
          const isOwnerRelation = item.ownerId === currentUser.id || (item.ownerIds && item.ownerIds.includes(currentUser.id));
          const isFollowerRelation = item.followerId === currentUser.id || (item.followerIds && item.followerIds.includes(currentUser.id));
          const isOwner = isOwnerRelation;
          const effectiveStatus = getRoleScopedStatus(item);
          const badge = getStatusBadge(effectiveStatus);
          const isPending = effectiveStatus === 'PENDING';
          const isReviewing = effectiveStatus === 'REVIEWING';
          const hasApproved = (item.timeline || []).some((n: any) => n.type === 'APPROVE' && n.user === currentUser.name);
          const canReview = isFollowerRelation && isReviewing && !hasApproved;
          const needFeedback = (effectiveStatus === 'EXECUTING' || effectiveStatus === 'DELAYED') && isOwner && canFeedbackItem;

          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
              className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 hover:shadow-md hover:border-slate-200 transition-all cursor-pointer"
              onClick={() => navigate(`/items/${item.id}`, { state: { from: '/my-items', label: '返回我的督办' } })}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{item.serialNo}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${badge.color}`}>
                      {badge.text}
                    </span>
                    {item.lightStatus && (
                      <span className={`flex items-center gap-1 text-xs font-bold ${
                        item.lightStatus === 'RED' ? 'text-red-500' :
                        item.lightStatus === 'YELLOW' ? 'text-amber-500' : 'text-green-500'
                      }`}>
                        <Zap className="w-3 h-3" />
                        {item.lightStatus === 'RED' ? '红灯' : item.lightStatus === 'YELLOW' ? '黄灯' : '绿灯'}
                      </span>
                    )}
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 mb-2 truncate">{item.title}</h3>
                  <div className="flex items-center gap-4 text-xs text-slate-400 flex-wrap">
                    <span className="flex items-center gap-1">
                      <User className="w-3.5 h-3.5" />
                      责任人：{item.ownerName}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="w-3.5 h-3.5" />
                      跟进人：{item.followerNames?.length ? item.followerNames.join('、') : item.followerName || '-'}
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5" />
                      责任部门：{(item.deptNames?.length ? item.deptNames.join('、') : '院长办公室')}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      提出会议：{item.meetingName || '-'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      提出时间：{formatDate(item.raiseDate)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      截止时间：{formatDate(item.deadline)}
                    </span>
                    {item.lastFeedbackDate && (
                      <span className="flex items-center gap-1">
                        <RefreshCw className="w-3.5 h-3.5" />
                        最后反馈：{formatDate(item.lastFeedbackDate)}
                      </span>
                    )}
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex flex-col gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {isPending && isOwner && canSignItem && (
                    <button
                      onClick={() => handleSignClick(item.id, item.title)}
                      className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-700 transition-all shadow-sm active:scale-95"
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                      签收
                    </button>
                  )}
                  {needFeedback && (
                    <button
                      onClick={() => {
                        setFeedbackDrawer({ open: true, itemId: item.id, itemTitle: item.title });
                      }}
                      className="flex items-center gap-1.5 bg-white text-blue-600 border border-blue-200 px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-50 transition-all active:scale-95"
                    >
                      <Send className="w-3.5 h-3.5" />
                      反馈进度
                    </button>
                  )}
                  {canReview && (
                    <>
                      <button
                        onClick={() => handleApprove(item.id)}
                        className="flex items-center gap-1.5 bg-green-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-green-700 transition-all shadow-sm active:scale-95"
                      >
                        <CheckSquare className="w-3.5 h-3.5" />
                        审批通过
                      </button>
                      <button
                        onClick={() => handleReject(item.id, item.title)}
                        className="flex items-center gap-1.5 bg-white text-red-600 border border-red-200 px-4 py-2 rounded-lg text-xs font-bold hover:bg-red-50 transition-all active:scale-95"
                      >
                        <X className="w-3.5 h-3.5" />
                        驳回
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => navigate(`/items/${item.id}`, { state: { from: '/my-items', label: '返回我的督办' } })}
                    className="flex items-center gap-1.5 bg-slate-50 text-slate-600 px-4 py-2 rounded-lg text-xs font-bold hover:bg-slate-100 transition-all"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    查看详情
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* 签收 Drawer */}
      <Drawer
        isOpen={signDrawer.open}
        onClose={() => {
          setSignDrawer({ open: false, itemId: '', itemTitle: '' });
          setSignPlannedDate('');
        }}
        title="签收任务"
        footer={
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => {
                setSignDrawer({ open: false, itemId: '', itemTitle: '' });
                setSignPlannedDate('');
              }}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
            >
              取消
            </button>
            <button
              onClick={() => handleSign(signDrawer.itemId, signDrawer.itemTitle, signPlannedDate)}
              disabled={!signPlannedDate}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all disabled:opacity-50"
            >
              确认签收
            </button>
          </div>
        }
      >
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

      {/* 进度反馈 Drawer */}
      <Drawer
        isOpen={feedbackDrawer.open}
        onClose={resetFeedbackDrawer}
        title="提交进度反馈"
        footer={
          <div className="flex gap-3 justify-end">
            <button
              onClick={resetFeedbackDrawer}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
            >
              取消
            </button>
            <button
              onClick={handleSubmitFeedback}
              disabled={!feedbackContent.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              提交反馈
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">事项</label>
            <p className="px-4 py-2 bg-slate-50 border border-slate-100 rounded-lg text-sm font-medium text-slate-600">
              {feedbackDrawer.itemTitle}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">反馈内容</label>
            <textarea
              rows={6}
              placeholder="请描述当前进展、完成情况、存在的问题及下一步计划..."
              className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm resize-none"
              value={feedbackContent}
              onChange={(e) => setFeedbackContent(e.target.value)}
            />
          </div>
          <div>
            <input
              ref={feedbackFileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) {
                  setFeedbackFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                  e.target.value = '';
                }
              }}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.zip"
            />
            <button
              type="button"
              onClick={() => feedbackFileInputRef.current?.click()}
              className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg transition-all"
            >
              <Paperclip className="w-4 h-4" />添加附件
            </button>
            {feedbackFiles.length > 0 && (
              <div className="mt-3 space-y-2">
                {feedbackFiles.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-700 truncate">{file.name}</p>
                      <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)}KB</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFeedbackFiles(prev => prev.filter((_, fileIndex) => fileIndex !== index))}
                      className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded"
                      aria-label="移除附件"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Drawer>
    </MainLayout>
  );
};

export default MyItems;
