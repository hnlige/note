import React, { useEffect, useMemo, useState } from 'react';
import { PaginationFooter } from '../../components/Common/PaginationFooter';
import { DEFAULT_PAGE_SIZE_OPTIONS, paginateItems } from '../../components/Common/pagination';
import { MainLayout } from '../../components/Layout/MainLayout';
import { useToast } from '../../components/Common/Toast';
import { useStore } from '../../store/useStore';
import { canUsePageAction } from '../../store/role-access';
import { filterVisibleItems } from '../../store/item-access';
import {
  Zap,
  MessageSquare,
  Phone,
  CheckCircle2,
  Eye,
  EyeOff,
  Search,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Drawer } from '../../components/Common/Drawer';
import { getTodayUrgeRecords } from './monitoring-metrics';
import { formatDateTime } from '../../lib/item-format';
import { api } from '../../lib/api';
import UrgeDashboard from './UrgeDashboard';

const STATUS_LABELS: Record<string, string> = {
  PENDING: '未开启',
  EXECUTING: '执行中',
  OVERDUE: '已超期',
  DELAYED: '已延期',
  SUSPENDED: '已暂缓',
  COMPLETED: '已完成',
  ARCHIVED: '已归档',
  DELETED: '已删除',
  DISABLED: '已废弃',
  NOT_SATISFIED: '未达标',
  REVIEWING: '审核中',
};

const URGEABLE_EXCLUDE = new Set(['COMPLETED', 'ARCHIVED', 'DELETED', 'DISABLED']);

function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch { /* ignore */ }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function isUrgeableStatus(status?: string): boolean {
  return !status || !URGEABLE_EXCLUDE.has(status);
}

type SingleTarget = {
  itemId: string;
  subTaskId: string | null;
  receiverId: string;
  receiverName: string;
  label: string;
};

const Monitoring: React.FC = () => {
  const {
    urgeRecords,
    currentUser,
    items,
    orgUsers,
    roles,
    departments,
    syncUrges,
    syncMessages,
  } = useStore();
  const { showToast } = useToast();
  const [tab, setTab] = useState<'manage' | 'dashboard'>('manage');
  const [isUrgeOpen, setIsUrgeOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [singleTarget, setSingleTarget] = useState<SingleTarget | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [method, setMethod] = useState<'SYSTEM' | 'MESSAGE' | 'PHONE'>('MESSAGE');
  const [content, setContent] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<{ byTarget: Record<string, number>; byItem: Record<string, number> }>({ byTarget: {}, byItem: {} });
  const [urging, setUrging] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE_OPTIONS[0]);

  const canUrge = canUsePageAction(currentUser, roles, 'MENU_MONITORING', 'URGE_ITEM');

  const validUrgeRecords = useMemo(() => {
    const validItemIds = new Set(items.filter(item => item.status !== 'DELETED').map(item => item.id));
    return urgeRecords.filter(record =>
      record.itemId &&
      validItemIds.has(record.itemId) &&
      record.itemTitle &&
      record.sender &&
      record.receiver &&
      record.status &&
      record.method,
    );
  }, [urgeRecords, items]);

  const scopedItems = useMemo(
    () => filterVisibleItems({ items, currentUser, orgUsers, roles, departments }),
    [items, currentUser, orgUsers, roles, departments],
  );
  const urgeableItems = useMemo(
    () => scopedItems.filter(item => !URGEABLE_EXCLUDE.has(item.status)),
    [scopedItems],
  );

  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return urgeableItems.filter(item => {
      const matchesSearch =
        !term ||
        item.title.toLowerCase().includes(term) ||
        item.ownerName.toLowerCase().includes(term) ||
        (item.followerName || '').toLowerCase().includes(term);
      const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [urgeableItems, searchTerm, statusFilter]);

  const filteredIds = useMemo(() => filteredItems.map(i => i.id), [filteredItems]);
  const selectedVisibleIds = useMemo(
    () => filteredIds.filter(id => selectedIds.includes(id)),
    [filteredIds, selectedIds],
  );
  const allSelected = filteredIds.length > 0 && selectedVisibleIds.length === filteredIds.length;
  const someSelected = selectedVisibleIds.length > 0 && !allSelected;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !filteredIds.includes(id)));
    } else {
      setSelectedIds(prev => [...new Set([...prev, ...filteredIds])]);
    }
  };
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const pagination = useMemo(
    () => paginateItems(filteredItems, page, pageSize),
    [filteredItems, page, pageSize],
  );

  useEffect(() => {
    if (page !== pagination.currentPage) setPage(pagination.currentPage);
  }, [page, pagination.currentPage]);

  const hasGlobalScope = roles
    .filter(r => (currentUser.roleIds || []).includes(r.id) || currentUser.roleId === r.id)
    .some(r => r.authCodes?.includes('ALL'));

  const todayRecords = useMemo(
    () => getTodayUrgeRecords(validUrgeRecords),
    [validUrgeRecords],
  );
  const visibleTodayRecords = useMemo(() => {
    if (hasGlobalScope) return todayRecords;
    return todayRecords.filter(r =>
      r.senderId === currentUser.id ||
      r.receiverId === currentUser.id ||
      r.sender === currentUser.name ||
      r.receiver === currentUser.name,
    );
  }, [todayRecords, hasGlobalScope, currentUser]);

  const latestUrgeByItem = useMemo(() => {
    const map = new Map<string, typeof validUrgeRecords[number]>();
    validUrgeRecords.forEach(r => {
      const prev = map.get(r.itemId);
      if (!prev || new Date(r.timestamp).getTime() > new Date(prev.timestamp).getTime()) map.set(r.itemId, r);
    });
    return map;
  }, [validUrgeRecords]);

  // 拉取责任人级催办次数（按事项+子任务+责任人聚合）
  useEffect(() => {
    let cancelled = false;
    const ids = pagination.rows.map(i => i.id);
    if (ids.length === 0) { setCounts({ byTarget: {}, byItem: {} }); return; }
    api.urges.counts(ids)
      .then((data) => { if (!cancelled) setCounts(data); })
      .catch(() => { if (!cancelled) setCounts({ byTarget: {}, byItem: {} }); });
    return () => { cancelled = true; };
  }, [pagination.rows]);

  const targetCount = (itemId: string, subTaskId: string | null, receiverId?: string): number => {
    if (!receiverId) return counts.byItem[itemId] || 0;
    return counts.byTarget[`${itemId}|${subTaskId || 'ROOT'}|${receiverId}`] || 0;
  };

  const incrementTargetCount = (itemId: string, subTaskId: string | null, receiverId: string) => {
    const targetKey = `${itemId}|${subTaskId || 'ROOT'}|${receiverId}`;
    setCounts((previous) => ({
      byTarget: {
        ...previous.byTarget,
        [targetKey]: (previous.byTarget[targetKey] || 0) + 1,
      },
      byItem: {
        ...previous.byItem,
        [itemId]: (previous.byItem[itemId] || 0) + 1,
      },
    }));
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openBatchDrawer = (itemIds: string[]) => {
    setSingleTarget(null);
    setSelectedIds(itemIds);
    setIsUrgeOpen(true);
  };

  const openSingleDrawer = (target: SingleTarget) => {
    setSingleTarget(target);
    setSelectedIds([]);
    setIsUrgeOpen(true);
  };

  const closeDrawer = () => {
    setIsUrgeOpen(false);
    setSingleTarget(null);
  };

  const refreshAfterUrge = async () => {
    try { await syncUrges(); } catch { /* ignore */ }
    try { await syncMessages(); } catch { /* ignore */ }
    const ids = pagination.rows.map(i => i.id);
    if (ids.length > 0) {
      try { const data = await api.urges.counts(ids); setCounts(data); } catch { /* ignore */ }
    }
  };

  const handleSend = async () => {
    if (!content.trim()) {
      showToast('请输入催办内容', 'warning');
      return;
    }
    if (singleTarget) {
      const key = `single-${singleTarget.itemId}-${singleTarget.subTaskId || 'root'}-${singleTarget.receiverId}-${genId()}`;
      setUrging(key);
      try {
        const result = await api.urges.create({
          itemId: singleTarget.itemId,
          receiverId: singleTarget.receiverId,
          receiver: singleTarget.receiverName,
          subTaskId: singleTarget.subTaskId ?? undefined,
          content: content.trim(),
          method,
          idempotencyKey: genId(),
        }) as { deduplicated?: boolean };
        if (!result.deduplicated) {
          incrementTargetCount(singleTarget.itemId, singleTarget.subTaskId, singleTarget.receiverId);
        }
        showToast(`已向 ${singleTarget.receiverName} 发起催办`, 'success');
        closeDrawer();
        setContent('');
        setMethod('MESSAGE');
        await refreshAfterUrge();
      } catch (e: any) {
        showToast(e?.message || '发起催办失败', 'error');
      } finally {
        setUrging(null);
      }
      return;
    }

    const targets = urgeableItems.filter(i => selectedIds.includes(i.id));
    if (targets.length === 0) {
      showToast('请先勾选需要催办的督办事项', 'warning');
      return;
    }
    setUrging('batch');
    try {
      const res: any = await api.urges.batch({
        itemIds: targets.map(t => t.id),
        content: content.trim(),
        method,
        idempotencyKey: genId(),
      });
      const parts: string[] = [];
      if (res.createdCount) parts.push(`成功 ${res.createdCount} 条`);
      if (res.duplicateCount) parts.push(`重复 ${res.duplicateCount} 条`);
      if (res.skipped?.length) parts.push(`跳过 ${res.skipped.length} 条（已完成/无责任人）`);
      showToast(parts.length ? `批量催办：${parts.join('，')}` : '批量催办完成', 'success');
      closeDrawer();
      setSelectedIds([]);
      setContent('');
      setMethod('MESSAGE');
      await refreshAfterUrge();
    } catch (e: any) {
      showToast(e?.message || '批量催办失败', 'error');
    } finally {
      setUrging(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'UNREAD': return <EyeOff className="w-4 h-4 text-slate-400" />;
      case 'READ': return <Eye className="w-4 h-4 text-blue-500" />;
      case 'RESPONDED': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      default: return null;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'UNREAD': return '未读';
      case 'READ': return '已读未处理';
      case 'RESPONDED': return '已反馈';
      default: return status;
    }
  };

  const getMethodIcon = (m: string) => {
    switch (m) {
      case 'SYSTEM': return <Zap className="w-4 h-4 text-blue-600" />;
      case 'MESSAGE': return <MessageSquare className="w-4 h-4 text-indigo-600" />;
      case 'PHONE': return <Phone className="w-4 h-4 text-orange-600" />;
      default: return null;
    }
  };

  const selectedCount = selectedVisibleIds.length;

  // 展开行：子任务责任人（无子任务时回退主责任人）
  const renderExpandedTargets = (item: any) => {
    const subTasks = Array.isArray(item.subTasks) ? item.subTasks : [];
    const rows: Array<{ key: string; subTaskId: string | null; title: string; assigneeId?: string; assigneeName?: string; status?: string }> = [];
    if (subTasks.length > 0) {
      subTasks.forEach((st: any) => {
        if (st?.assigneeId) {
          rows.push({ key: `${item.id}-${st.id}-${st.assigneeId}`, subTaskId: st.id, title: st.title || '子任务', assigneeId: st.assigneeId, assigneeName: st.assigneeName, status: st.status });
        } else {
          rows.push({ key: `${item.id}-${st.id}-none`, subTaskId: st.id, title: st.title || '子任务', assigneeName: undefined, status: st.status });
        }
      });
    } else if (item.ownerId) {
      rows.push({ key: `${item.id}-owner`, subTaskId: null, title: '主责任人', assigneeId: item.ownerId, assigneeName: item.ownerName, status: item.status });
    }
    if (rows.length === 0) {
      return (
        <tr key={`${item.id}-empty`} className="bg-slate-50/40">
          <td className="px-6 py-2 text-xs text-slate-400" colSpan={canUrge ? 7 : 6}>该事项暂无责任人，无法催办</td>
        </tr>
      );
    }
    return rows.map((row) => {
      const urgeDisabled = !row.assigneeId || !isUrgeableStatus(row.status) || urging !== null;
      const count = targetCount(item.id, row.subTaskId, row.assigneeId);
      return (
        <tr key={row.key} className="bg-slate-50/40 group/child hover:bg-slate-100/60">
          <td className="px-6 py-2" />
          <td className="px-6 py-2 pl-12">
            <p className="text-xs text-slate-500">
              <span className="text-slate-400">↳</span> {row.title}
            </p>
          </td>
          <td className="px-6 py-2">
            {row.assigneeName ? (
              <span className="text-xs font-semibold text-slate-700">{row.assigneeName}</span>
            ) : (
              <span className="text-xs text-slate-300">无责任人</span>
            )}
            {row.status && !isUrgeableStatus(row.status) && (
              <span className="ml-2 text-[10px] text-slate-400">{STATUS_LABELS[row.status] || row.status}</span>
            )}
          </td>
          <td className="px-6 py-2">
            <span className="text-xs font-bold text-slate-600">已催办 {count} 次</span>
          </td>
          <td className="px-6 py-2" colSpan={canUrge ? 2 : 1}>
            {canUrge && row.assigneeId && (
              <button
                disabled={urgeDisabled}
                onClick={() => openSingleDrawer({
                  itemId: item.id,
                  subTaskId: row.subTaskId,
                  receiverId: row.assigneeId!,
                  receiverName: row.assigneeName || row.assigneeId!,
                  label: row.title,
                })}
                className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 px-2.5 py-1 rounded-lg hover:bg-red-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Zap className="w-3 h-3" />
                催办
              </button>
            )}
          </td>
          {canUrge && <td className="px-6 py-2" />}
        </tr>
      );
    });
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">催办管理</h1>
          <p className="text-slate-500 text-sm mt-1">父子级结构：父事项可批量催办全部子任务责任人，子任务可单独催办指定责任人，催办次数按“任务＋责任人”独立累计。</p>
          <div className="flex items-center gap-1 mt-3 bg-slate-100 rounded-lg p-1 w-fit">
            <button
              onClick={() => setTab('manage')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${tab === 'manage' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              催办管理
            </button>
            <button
              onClick={() => setTab('dashboard')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${tab === 'dashboard' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              统计看板
            </button>
          </div>
        </div>
        {canUrge && tab === 'manage' && (
          <button
            onClick={() => openBatchDrawer(selectedVisibleIds.length ? selectedVisibleIds : (pagination.rows[0] ? [pagination.rows[0].id] : []))}
            disabled={filteredItems.length === 0}
            className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-red-700 transition-all shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Zap className="w-4 h-4" />
            <span>批量催办{selectedCount > 0 ? `（${selectedCount}）` : ''}</span>
          </button>
        )}
      </div>

      {tab === 'dashboard' ? (
        <UrgeDashboard />
      ) : (
        <>
          {/* KPI：今日催办总数 */}
          <div className="mb-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm md:w-1/3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-400 uppercase">今日催办总数</span>
            <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">今日</span>
          </div>
          <h2 className="text-3xl font-bold text-slate-900">{visibleTodayRecords.length}</h2>
          <div className="mt-4 flex items-center gap-4">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-xs text-slate-500">系统 {visibleTodayRecords.filter(r => r.method === 'SYSTEM').length}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-indigo-500" />
              <span className="text-xs text-slate-500">人工 {visibleTodayRecords.filter(r => r.method !== 'SYSTEM').length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 督办列表（可勾选，支持展开子任务） */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mb-8">
        <div className="px-6 pt-5">
          <h3 className="text-base font-bold text-slate-800">督办列表</h3>
          <p className="text-xs text-slate-400 mt-0.5">勾选事项后点击右上角“批量催办”集中催办；展开行可查看子任务并单独催办某位责任人。</p>
        </div>
        <div className="p-6 border-b border-slate-50 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="搜索事项标题、责任人、跟进人..."
                className="w-full bg-slate-50 border-none rounded-lg py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-blue-500"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
              />
            </div>
            <select
              className="text-sm bg-slate-100 border-none rounded-lg py-2 px-3 text-slate-600 font-medium focus:ring-2 focus:ring-blue-500"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="ALL">全部状态</option>
              <option value="PENDING">未开启</option>
              <option value="EXECUTING">执行中</option>
              <option value="OVERDUE">已超期</option>
              <option value="DELAYED">已延期</option>
              <option value="SUSPENDED">已暂缓</option>
              <option value="REVIEWING">审核中</option>
            </select>
            <span className="text-xs text-slate-400">共 {filteredItems.length} 项</span>
          </div>
          {selectedCount > 0 && (
            <button
              onClick={() => setSelectedIds([])}
              className="text-xs text-slate-500 hover:text-slate-700 underline"
            >
              清空选择
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                <th className="px-6 py-4 w-12">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-red-600 cursor-pointer"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleSelectAll}
                    aria-label="全选"
                  />
                </th>
                <th className="px-6 py-4">督办事项</th>
                <th className="px-6 py-4">责任人 / 跟进人</th>
                <th className="px-6 py-4">状态</th>
                <th className="px-6 py-4">催办次数</th>
                <th className="px-6 py-4">最近催办</th>
                {canUrge && <th className="px-6 py-4 text-right">操作</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {pagination.rows.map((item) => {
                const checked = selectedIds.includes(item.id);
                const last = latestUrgeByItem.get(item.id);
                const hasSubTasks = Array.isArray(item.subTasks) && item.subTasks.length > 0;
                const expanded = expandedIds.has(item.id);
                const itemCount = counts.byItem[item.id] || 0;
                return (
                  <React.Fragment key={item.id}>
                    <tr className="group hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-red-600 cursor-pointer"
                          checked={checked}
                          onChange={() => toggleSelect(item.id)}
                          aria-label={`选择 ${item.title}`}
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1">
                          {hasSubTasks && (
                            <button
                              onClick={() => toggleExpand(item.id)}
                              className="text-slate-400 hover:text-slate-600"
                              aria-label={expanded ? '收起' : '展开'}
                            >
                              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          )}
                          <div>
                            <p className="text-sm font-bold text-slate-900 line-clamp-1">{item.title}</p>
                            <p className="text-xs text-slate-400 mt-0.5">{item.serialNo || item.category}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-slate-700 font-semibold">{item.ownerName}</p>
                        <p className="text-xs text-slate-400">{item.followerName || '—'}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusBadgeClass(item.status)}`}>
                          {STATUS_LABELS[item.status] || item.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-bold text-slate-600">共 {itemCount} 次</span>
                      </td>
                      <td className="px-6 py-4">
                        {last ? (
                          <div>
                            <p className="text-xs text-slate-500">{formatDateTime(last.timestamp)}</p>
                            <div className="flex items-center gap-1 mt-0.5">
                              {getStatusIcon(last.status)}
                              <span className="text-xs font-bold text-slate-600">{getStatusText(last.status)}</span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">未催办</span>
                        )}
                      </td>
                      {canUrge && (
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              disabled={urging !== null}
                              onClick={() => openBatchDrawer([item.id])}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 px-3 py-1.5 rounded-lg hover:bg-red-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Zap className="w-3.5 h-3.5" />
                              催办全部
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {expanded && renderExpandedTargets(item)}
                  </React.Fragment>
                );
              })}
              {pagination.rows.length === 0 && (
                <tr>
                  <td colSpan={canUrge ? 7 : 6} className="px-6 py-12 text-center text-sm text-slate-400">
                    当前范围内没有可催办的督办事项
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filteredItems.length > 0 && (
          <PaginationFooter
            totalItems={filteredItems.length}
            currentPage={pagination.currentPage}
            totalPages={pagination.totalPages}
            pageSize={pageSize}
            pageSizeOptions={DEFAULT_PAGE_SIZE_OPTIONS}
            itemLabel="事项"
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => { setPage(1); setPageSize(nextPageSize); }}
          />
        )}
      </div>

      {/* 今日催办记录 */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700">今日催办记录</h3>
          <span className="text-xs text-slate-400">仅显示今日下发记录</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                <th className="px-6 py-4">催办事项</th>
                <th className="px-6 py-4">催办方式 / 发起人</th>
                <th className="px-6 py-4">被催办人</th>
                <th className="px-6 py-4">回执状态</th>
                <th className="px-6 py-4">时间 / 反馈摘要</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {visibleTodayRecords.map((record) => (
                <tr key={record.id} className="group hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="text-sm font-bold text-slate-900 line-clamp-1">{record.itemTitle}</p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                        {getMethodIcon(record.method)}
                      </div>
                      <span className="text-sm text-slate-600 font-medium">{record.sender}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 font-semibold">{record.receiver}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5">
                      {getStatusIcon(record.status)}
                      <span className="text-xs font-bold text-slate-600">{getStatusText(record.status)}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div>
                      <p className="text-xs text-slate-400 font-medium mb-1">{formatDateTime(record.timestamp)}</p>
                      {record.responseContent && (
                        <p className="text-xs text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-md inline-block">
                          {record.responseContent}
                        </p>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {visibleTodayRecords.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-400">
                    今日暂无催办记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
          </div>
        </>
      )}

      {tab === 'manage' && (
        <Drawer
        isOpen={isUrgeOpen}
        onClose={closeDrawer}
        title={singleTarget ? `催办责任人：${singleTarget.receiverName}` : '批量催办'}
        footer={
          <div className="flex gap-3 justify-end">
            <button
              onClick={closeDrawer}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
            >
              取消
            </button>
            <button
              onClick={handleSend}
              disabled={urging !== null}
              className="px-6 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-all shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {urging ? '发送中…' : '立即发送'}
            </button>
          </div>
        }
      >
        <div className="space-y-6">
          <div className="bg-red-50 border border-red-100 rounded-lg p-4">
            {singleTarget ? (
              <>
                <p className="text-sm text-red-700 font-semibold">催办对象：{singleTarget.label} · {singleTarget.receiverName}</p>
                <p className="text-xs text-red-500 mt-1">仅对该责任人计次 +1，其他责任人不受影响。</p>
              </>
            ) : (
              <>
                <p className="text-sm text-red-700 font-semibold">已选择 {selectedVisibleIds.length} 个督办事项</p>
                <p className="text-xs text-red-500 mt-1">将向每个事项的全部未完成子任务责任人发起催办，每位责任人分别计次 +1，并写入事项时间轴。</p>
              </>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">催办方式</label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'SYSTEM' as const, label: '系统提示', icon: <Zap className="w-4 h-4" /> },
                { id: 'MESSAGE' as const, label: '短消息', icon: <MessageSquare className="w-4 h-4" /> },
                { id: 'PHONE' as const, label: '电话催办', icon: <Phone className="w-4 h-4" /> },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                    method === m.id
                      ? 'bg-blue-50 border-blue-500 text-blue-600'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m.icon}
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">催办内容<span className="text-red-500">*</span></label>
            <textarea
              rows={4}
              placeholder="请输入催办具体要求..."
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
        </div>
      </Drawer>
      )}
    </MainLayout>
  );
};

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'PENDING': return 'bg-slate-100 text-slate-600';
    case 'EXECUTING': return 'bg-blue-50 text-blue-600';
    case 'OVERDUE': return 'bg-red-50 text-red-600';
    case 'DELAYED': return 'bg-amber-50 text-amber-600';
    case 'SUSPENDED': return 'bg-purple-50 text-purple-600';
    case 'REVIEWING': return 'bg-indigo-50 text-indigo-600';
    default: return 'bg-slate-100 text-slate-500';
  }
}

export default Monitoring;
