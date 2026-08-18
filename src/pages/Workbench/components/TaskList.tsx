import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronRight, Zap, Paperclip } from 'lucide-react';
import { useStore } from '../../../store/useStore';
import { SupervisionItem, UserRole } from '../../../types';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Drawer } from '../../../components/Common/Drawer';
import { PaginationFooter } from '../../../components/Common/PaginationFooter';
import { useToast } from '../../../components/Common/Toast';
import {
  compareItemsByRaiseDateDesc,
  formatDate,
  getEffectiveItemStatus,
  getItemStatusLabel,
  getItemStatusStyle,
  getUserSubTaskForIdentity,
  isItemFollowerForUser,
  isItemOwnerForUser,
  isManualDateOnOrAfter,
  isValidManualDateInput,
  normalizeManualDateInput,
  todayDateString,
  updateUserSubTaskForIdentity,
} from '../../../lib/item-format';
import { filterVisibleItems } from '../../../store/item-access';
import { mapRoleIdentityToUserRole } from '../../../store/role-access';
import { getActionBarMode } from './action-bar-mode';
import { getWorkbenchRowActionVisibility } from './task-list-actions';
import { buildOwnerWorkbenchTaskListItems } from '../../../lib/owner-workbench';
import { buildMyItemsScope } from '../../MyItems/my-items-scope';
import { paginateTaskListItems, TASK_LIST_PAGE_SIZE_OPTIONS } from './task-list-pagination';

export const TaskList: React.FC = () => {
  const { currentUser, items, updateItem, addActivity, addUrgeRecord, searchTerm, orgUsers, roles, departments, addLog } = useStore();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const mode = getActionBarMode(currentUser, roles);
  const [displayMode, setDisplayMode] = useState<'parent' | 'parentAndSubtasks'>('parent');

  const visibleItems = filterVisibleItems({ items, currentUser, orgUsers, roles, departments });
  // owner 模式下，纯跟进人（如 r2 督办跟进人，虽具备 SIGN_ITEM/FEEDBACK_ITEM 能力）
  // 的「我的待办任务」须纳入其作为跟进人的事项，与首页卡片口径（item 模式 + isFollower）
  // 及《我的督办》个人页保持一致，避免「卡片有 9 条、列表 0 条」的错位。
  // 纯责任人保持原 buildOwnerWorkbenchTaskListItems 口径不变。
  const effectiveUser = orgUsers.find(u => u.id === currentUser.id) || currentUser;
  const isFollower = mapRoleIdentityToUserRole(effectiveUser) === 'FOLLOWER';
  const scopedItems = mode === 'owner'
    ? (isFollower
        ? buildMyItemsScope(visibleItems, currentUser).todoItems
        : buildOwnerWorkbenchTaskListItems(visibleItems, currentUser))
    : visibleItems;

  const filteredItems = scopedItems.filter(item => {
    // 搜索过滤
    const keyword = searchTerm.toLowerCase();
    const matchesSearch = [
      item.title,
      item.serialNo,
      item.ownerName,
      ...(item.ownerNames || []),
      item.meetingName,
    ]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .some(value => value.toLowerCase().includes(keyword));
    return matchesSearch;
  });

  // 按"提出时间"倒序排列（最新日期的在最上面）
  const sortedItems = useMemo(() => [...filteredItems].sort(compareItemsByRaiseDateDesc), [filteredItems]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(TASK_LIST_PAGE_SIZE_OPTIONS[0]);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isUrgeOpen, setIsUrgeOpen] = useState(false);
  const [isSignOpen, setIsSignOpen] = useState(false);
  const [signTargetItem, setSignTargetItem] = useState<SupervisionItem | null>(null);
  const [signPlannedDate, setSignPlannedDate] = useState('');
  const [selectedItem, setSelectedItem] = useState<SupervisionItem | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [urgeContent, setUrgeContent] = useState('');
  const pagination = useMemo(
    () => paginateTaskListItems(sortedItems, page, pageSize),
    [sortedItems, page, pageSize],
  );

  useEffect(() => {
    if (page !== pagination.currentPage) {
      setPage(pagination.currentPage);
    }
  }, [page, pagination.currentPage]);

  // 签收时是否需要填写计划完成日期：只看 plannedCompletionDate 是否为空。
  // 不再把 requiredCompletionDate 算作已填——签收必须写入 plannedCompletionDate。
  const requiresPlannedDateOnSign = (item: SupervisionItem) => {
    const subTask = getUserSubTaskForIdentity(item, currentUser);
    if (subTask) return !subTask.plannedCompletionDate;
    return !item.plannedCompletionDate;
  };

  const closeSignDrawer = () => {
    setIsSignOpen(false);
    setSignTargetItem(null);
    setSignPlannedDate('');
  };

  const handleSign = async (plannedDate?: string) => {
    if (!signTargetItem) return;
    const target = signTargetItem;
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
    const subTaskUpdates = updateUserSubTaskForIdentity(target, currentUser, { status: 'EXECUTING', ...plannedDateUpdates });
    const saved = await updateItem(target.id, {
      ...plannedDateUpdates,
      ...subTaskUpdates,
      status: subTaskUpdates.status || 'EXECUTING',
      timeline: [
        ...target.timeline,
        {
          id: 't' + Date.now(),
          type: 'SIGN',
          user: currentUser.name,
          content: plannedDate ? `签收了该督办事项，计划完成日期：${plannedDate}` : '签收了该督办事项',
          timestamp: new Date().toLocaleString()
        }
      ]
    }, 'MENU_WORKBENCH');
    if (!saved) {
      showToast('签收失败，请稍后重试', 'error');
      return;
    }
    addActivity({
      content: `您签收了事项：【${target.title}】`,
      type: 'STATUS_CHANGE'
    });
    addLog({
      userName: currentUser.name,
      userId: currentUser.id,
      action: `签收事项: ${target.title}`,
      module: '督办事项',
    });
    showToast('已签收该事项', 'success');
    closeSignDrawer();
  };

  const handleSignClick = (e: React.MouseEvent, item: SupervisionItem) => {
    e.stopPropagation();
    if (requiresPlannedDateOnSign(item)) {
      // 带出要求完成日期作为默认值（若有），便于确认或调整后签收
      const subTask = getUserSubTaskForIdentity(item, currentUser);
      const defaultDate = subTask?.requiredCompletionDate || item.requiredCompletionDate || '';
      setSignTargetItem(item);
      setSignPlannedDate(defaultDate);
      setIsSignOpen(true);
      return;
    }
    setSignTargetItem(item);
    handleSign();
  };

  const handleFeedbackSubmit = () => {
    if (!feedbackText.trim() || !selectedItem) return;
    
    const newNode = {
      id: 't' + Date.now(),
      type: 'FEEDBACK' as const,
      user: currentUser.name,
      content: feedbackText,
      timestamp: new Date().toLocaleString()
    };

    updateItem(selectedItem.id, {
      ...(selectedItem.status === 'PENDING' ? { status: 'EXECUTING' as const } : {}),
      timeline: [...selectedItem.timeline, newNode],
      lastFeedbackDate: todayDateString(),
      progress: Math.min(selectedItem.progress + 10, 90)
    }, 'MENU_WORKBENCH');

    addActivity({
      content: `您提交了【${selectedItem.title}】的进度反馈`,
      type: 'FEEDBACK'
    });

    setIsFeedbackOpen(false);
    setFeedbackText('');
    setSelectedItem(null);
  };

  const handleUrgeSubmit = () => {
    if (!urgeContent.trim() || !selectedItem) return;

    addUrgeRecord({
      itemId: selectedItem.id,
      itemTitle: selectedItem.title,
      senderId: currentUser.id,
      sender: currentUser.name,
      receiverId: selectedItem.ownerId,
      receiver: selectedItem.ownerName,
      status: 'UNREAD',
      method: 'MESSAGE',
      content: urgeContent
    });

    updateItem(selectedItem.id, {
      timeline: [
        ...selectedItem.timeline,
        {
          id: 't' + Date.now(),
          type: 'URGE',
          user: currentUser.name,
          content: `【催办】${urgeContent}`,
          timestamp: new Date().toLocaleString()
        }
      ]
    }, 'MENU_WORKBENCH');

    addActivity({
      content: `您对【${selectedItem.title}】执行了催办`,
      type: 'URGE'
    });

    setIsUrgeOpen(false);
    setUrgeContent('');
    setSelectedItem(null);
  };

  const getStatusStyle = (status: string) => {
    return getItemStatusStyle(status);
  };

  const getStatusText = (status: string) => {
    return getItemStatusLabel(status);
  };

  const renderActions = (item: SupervisionItem) => {
    const effectiveStatus = getEffectiveItemStatus(item);
    // 签收按钮仅取决于「当前责任人本人是否已签收」，不受其他责任人影响：用本人子任务状态判定
    const mySubTask = getUserSubTaskForIdentity(item, currentUser);
    const perOwnerStatus = mySubTask ? mySubTask.status : effectiveStatus;
    // 行内角色取决于「当前用户在此事项中的身份」：双重身份用户（同时为跟进人与责任人）按其在本事项的归属判定，
    // 避免被全局 roleId（如 r2 跟进人）错判为 FOLLOWER 而丢失责任人视图下的签收/反馈按钮。
    const rowRoleKind: UserRole =
      isItemOwnerForUser(item, currentUser)
        ? 'OWNER'
        : isItemFollowerForUser(item, currentUser)
          ? 'FOLLOWER'
          : mapRoleIdentityToUserRole(currentUser);
    const { canSign, canFeedback } = getWorkbenchRowActionVisibility(rowRoleKind, currentUser, roles, perOwnerStatus);

    // 始终提供「详情」入口（【督办任务列表】操作-进入督办详情页）
    const detailButton = (
      <button
        onClick={(e) => {
          e.stopPropagation();
          navigate(`/items/${item.id}`, { state: { from: '/workbench', label: '返回工作台' } });
        }}
        className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
      >
        详情 <ChevronRight className="w-4 h-4" />
      </button>
    );

    if (rowRoleKind === 'OWNER' && (canSign || canFeedback)) {
      return (
        <div className="flex items-center justify-end gap-2 opacity-100 transition-all group-hover:translate-x-0">
          {canSign && (
            <button
              onClick={(e) => handleSignClick(e, item)}
              className="text-xs font-bold text-white bg-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-all active:scale-95 shadow-sm shadow-blue-100"
            >
              签收
            </button>
          )}
          {canFeedback && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedItem(item);
                setIsFeedbackOpen(true);
              }}
              className="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg hover:bg-slate-200 transition-all"
            >
              反馈
            </button>
          )}
          {detailButton}
        </div>
      );
    }
    if (rowRoleKind === 'FOLLOWER') {
      // 督办跟进人工作台不展示行内操作按钮（签收/催办），仅提供进入详情入口
      return detailButton;
    }
    return detailButton;
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-6 border-b border-slate-50 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-bold text-slate-900">
            {mode === 'owner' ? '我的待办任务' : '督办事项'}
          </h3>
          <div className="flex items-center bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setDisplayMode('parent')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                displayMode === 'parent'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              父级
            </button>
            <button
              onClick={() => setDisplayMode('parentAndSubtasks')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                displayMode === 'parentAndSubtasks'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              父级+子集
            </button>
          </div>
        </div>
        <button
          onClick={() => navigate('/items')}
          className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
        >
          查看全部 <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50/50 text-slate-500 text-xs font-bold uppercase tracking-wider">
              <th className="px-6 py-4">督办序号</th>
              <th className="px-6 py-4">提出会议</th>
              <th className="px-6 py-4">督办跟进人员</th>
              <th className="px-6 py-4">提出时间</th>
              <th className="px-6 py-4">当前状态</th>
              <th className="px-6 py-4">负责人</th>
              <th className="px-6 py-4">截止日期</th>
              <th className="px-6 py-4 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {pagination.rows.map((item, index) => {
              const effectiveStatus = getEffectiveItemStatus(item);
              const subTasks = item.subTasks || [];
              const hasChildren = subTasks.length > 1;
              const showChildren = displayMode === 'parentAndSubtasks' && hasChildren;
              const childRow = (st: typeof subTasks[number]) => (
                <tr key={st.id} className="bg-slate-50/40 hover:bg-slate-100/60">
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2 pl-6">
                      <span className="w-1 h-1 rounded-full bg-slate-300 shrink-0" />
                    </div>
                  </td>
                  <td className="px-6 py-3" />
                  <td className="px-6 py-3" />
                  <td className="px-6 py-3" />
                  <td className="px-6 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${getStatusStyle(st.status)}`}>
                      {getStatusText(st.status)}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-medium px-2 py-0.5 rounded-lg">
                      {st.assigneeName || '未指定责任人'}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2 text-slate-500">
                      <Calendar className="w-4 h-4" />
                      <span className="text-sm">{formatDate(st.plannedCompletionDate || st.deadline || st.requiredCompletionDate)}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3" />
                </tr>
              );
              return (
              <React.Fragment key={item.id}>
              <motion.tr
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + index * 0.05 }}
                onClick={() => navigate(`/items/${item.id}`, { state: { from: '/workbench', label: '返回工作台' } })}
                className="group hover:bg-slate-50/50 transition-colors cursor-pointer"
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded font-mono">{item.serialNo}</span>
                    {item.lightStatus && (
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        item.lightStatus === 'RED' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]' :
                        item.lightStatus === 'YELLOW' ? 'bg-yellow-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]' :
                        'bg-green-500'
                      }`} />
                    )}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-col gap-0.5">
                    {item.meetingName && <span className="text-sm text-slate-600 font-medium">{item.meetingName}</span>}
                    {item.raiseDate && <span className="text-xs text-slate-400">{formatDate(item.raiseDate)}</span>}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {(item.followerNames?.length ? item.followerNames : item.followerName ? [item.followerName] : ['-']).map((name, i) => (
                      <span key={i} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-lg">{name}</span>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm text-slate-600 font-medium">{formatDate(item.raiseDate)}</span>
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${getStatusStyle(effectiveStatus)}`}>
                    {getStatusText(effectiveStatus)}
                    {hasChildren && <span className="opacity-75 font-medium ml-1">{subTasks.filter(t => t.status === 'COMPLETED' || t.status === 'ARCHIVED').length}/{subTasks.length}</span>}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {(item.ownerNames?.length ? item.ownerNames : item.ownerName ? [item.ownerName] : ['-']).map((name, i) => (
                      <span key={i} className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-medium px-2 py-0.5 rounded-lg">{name}</span>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Calendar className="w-4 h-4" />
                    <span className="text-sm">{formatDate(item.requiredCompletionDate)}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  {renderActions(item)}
                </td>
              </motion.tr>
              {showChildren && subTasks.map(childRow)}
              </React.Fragment>
            );})}
          </tbody>
        </table>
      </div>

      <PaginationFooter
        totalItems={sortedItems.length}
        currentPage={pagination.currentPage}
        totalPages={pagination.totalPages}
        pageSize={pageSize}
        pageSizeOptions={TASK_LIST_PAGE_SIZE_OPTIONS}
        itemLabel="事项"
        onPageChange={setPage}
        onPageSizeChange={(nextPageSize) => {
          setPage(1);
          setPageSize(nextPageSize);
        }}
      />

      {/* Sign Drawer（工作台签收计划完成日期，与详情页/事项列表页保持一致） */}
      <Drawer
        isOpen={isSignOpen}
        onClose={closeSignDrawer}
        title="签收任务"
        footer={
          <div className="flex gap-3 justify-end">
            <button onClick={closeSignDrawer} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
            <button onClick={() => handleSign(signPlannedDate)} disabled={!signPlannedDate} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all disabled:opacity-50">确认签收</button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700">
            请填写计划完成日期后再签收。签收后事项将进入执行中，可继续提交反馈。
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-2">事项名称</p>
            <p className="text-sm font-bold text-slate-900">{signTargetItem?.title}</p>
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

      {/* Inline Feedback Drawer */}
      <Drawer
        isOpen={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        title="快速反馈进展"
        footer={
          <div className="flex gap-3 justify-end">
            <button onClick={() => setIsFeedbackOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
            <button onClick={handleFeedbackSubmit} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 shadow-md shadow-blue-100 transition-all">提交反馈</button>
          </div>
        }
      >
        <div className="space-y-6">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-2">事项名称</p>
            <p className="text-sm font-bold text-slate-900">{selectedItem?.title}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">进展说明</label>
            <div className="relative">
              <textarea 
                rows={6}
                placeholder="请描述当前工作进度、遇到的问题及下一步计划..."
                className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
              />
              <div className="absolute right-4 bottom-4 flex items-center gap-2">
                <button className="p-2 text-slate-400 hover:text-blue-600 transition-colors">
                  <Paperclip className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </Drawer>

      {/* Inline Urge Drawer */}
      <Drawer
        isOpen={isUrgeOpen}
        onClose={() => setIsUrgeOpen(false)}
        title="发送催办指令"
        footer={
          <div className="flex gap-3 justify-end">
            <button onClick={() => setIsUrgeOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
            <button onClick={handleUrgeSubmit} className="px-6 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 shadow-md shadow-red-100 transition-all">立即催办</button>
          </div>
        }
      >
        <div className="space-y-6">
          <div className="flex items-center gap-4 p-4 bg-red-50 rounded-2xl border border-red-100">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-600">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-red-900">催办对象：{selectedItem?.ownerName}</p>
              <p className="text-xs text-red-700 mt-0.5">该指令将通过系统站内信及短消息下发</p>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">催办内容</label>
            <textarea 
              rows={4}
              placeholder="请输入具体的催办要求，如：请于今日下班前反馈最新进度。"
              className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all resize-none"
              value={urgeContent}
              onChange={(e) => setUrgeContent(e.target.value)}
            />
          </div>
        </div>
      </Drawer>
    </div>
  );
};
