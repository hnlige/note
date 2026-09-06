import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CreateItemModal } from '../../components/Common/CreateItemModal';
import { Drawer } from '../../components/Common/Drawer';
import { PaginationFooter } from '../../components/Common/PaginationFooter';
import { MainLayout } from '../../components/Layout/MainLayout';
import { FilterPanel } from './components/FilterPanel';
import { useStore } from '../../store/useStore';
import { Plus, Download, ChevronRight, ChevronDown, Calendar, Zap, Trash2, Filter, X, CheckSquare, Square } from 'lucide-react';
import { SupervisionItem, DeptNode, OrgUser } from '../../types';
import { formatDate, getEffectiveItemStatus, getItemStatusLabel, getItemStatusStyle, getItemSignOffStatus, getSignOffStatusLabel, getSignOffStatusStyle, getUniqueTimeline, normalizeManualDateInput, compareItemsByRaiseDateDesc, isItemOwnerForUser, isItemRelatedToUser } from '../../lib/item-format';
import { downloadCsv, downloadExcel } from '../../lib/export-csv';
import { canUsePageAction, getAssignedRoleIds } from '../../store/role-access';
import { buildItemExportConfig, ItemExportFieldPreset, ItemExportFormat } from '../../lib/item-export';
import { isWorkbenchNoFeedbackItem, isWorkbenchIncompleteItem, isWorkbenchPendingOpenItem, isUserWorkbenchItem } from '../Workbench/components/workbench-metrics';
import { filterVisibleItems, getEffectiveRoleScope } from '../../store/item-access';
import { isOwnerDueSoonItem, isOwnerOnTimeCompletedItem } from '../../lib/owner-workbench';
import { buildDepartmentFilterLookup, matchesDepartmentFilter, getScopedDepartmentOptions } from './department-filter';
import { DEFAULT_PAGE_SIZE_OPTIONS, paginateItems } from '../../components/Common/pagination';

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

const Items: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { items, currentUser, searchTerm, deleteItem, addLog, orgUsers, departments, roles } = useStore();

  const urlStatusFilter = searchParams.get('status');
  const urlLightStatusFilter = searchParams.get('lightStatus');
  const urlOwnerId = searchParams.get('ownerId');
  const urlFollowerId = searchParams.get('followerId');
  const urlNoFeedback = searchParams.get('noFeedback');
  const urlSignOff = searchParams.get('signOff');
  const urlIncomplete = searchParams.get('incomplete');
  const urlPendingOpen = searchParams.get('pendingOpen');
  const urlScope = searchParams.get('scope');
  const urlDueSoon = searchParams.get('dueSoon');
  const urlOnTimeCompleted = searchParams.get('onTimeCompleted');

  const resolvedOwnerId = urlOwnerId === 'me' ? currentUser.id : urlOwnerId;
  const resolvedFollowerId = urlFollowerId === 'me' ? currentUser.id : urlFollowerId;

  const [localStatusFilter, setLocalStatusFilter] = useState('');
  const [localDepartmentFilter, setLocalDepartmentFilter] = useState('');
  const [localDateFrom, setLocalDateFrom] = useState('');
  const [localDateTo, setLocalDateTo] = useState('');
  const [localSearch, setLocalSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE_OPTIONS[0]);

  const ownerDeptMap = useMemo(() => {
    const map: Record<string, string> = {};
    orgUsers.forEach((u: OrgUser) => {
      if (u.deptId) {
        const name = findDeptName(departments, u.deptId);
        if (name) map[u.id] = name;
      }
    });
    return map;
  }, [orgUsers, departments]);

  const departmentFilterLookup = useMemo(
    () => buildDepartmentFilterLookup(departments, orgUsers),
    [departments, orgUsers],
  );

  // 按角色数据范围裁剪「责任部门」下拉选项（部门管理员/督办责任人/组织管理员各见其范围）
  const scopedDepartmentOptions = useMemo(() => {
    const roleScope = getEffectiveRoleScope(currentUser, roles);
    if (!roleScope) return departmentFilterLookup.options;
    return getScopedDepartmentOptions({
      options: departmentFilterLookup.options,
      departments,
      dataScope: roleScope.dataScope,
      orgIds: roleScope.orgIds,
      adminOrgIds: currentUser.adminOrgIds || [],
      userDeptId: currentUser.deptId,
    });
  }, [departmentFilterLookup.options, departments, currentUser, roles]);

  const handleReset = useCallback(() => {
    setLocalStatusFilter('');
    setLocalDepartmentFilter('');
    setLocalDateFrom('');
    setLocalDateTo('');
    setLocalSearch('');
    setSelectedIds(new Set());
  }, []);

  // 勾选逻辑
  const toggleSelect = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 多责任人父级展开/收起子集任务
  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const hasUrlParams = !!(urlStatusFilter || urlLightStatusFilter || urlOwnerId || urlFollowerId || urlNoFeedback || urlSignOff || urlIncomplete || urlPendingOpen || urlDueSoon || urlOnTimeCompleted || urlScope);
  const hasLocalFilters = !!(localStatusFilter || localDepartmentFilter || localDateFrom || localDateTo || localSearch);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (urlStatusFilter) count++;
    if (urlLightStatusFilter) count++;
    if (urlOwnerId || urlFollowerId) count++;
    if (urlNoFeedback) count++;
    if (urlSignOff) count++;
    if (urlIncomplete) count++;
    if (urlPendingOpen) count++;
    if (urlScope) count++;
    if (localStatusFilter) count++;
    if (localDepartmentFilter) count++;
    if (localDateFrom || localDateTo) count++;
    if (localSearch) count++;
    return count;
  }, [urlStatusFilter, urlLightStatusFilter, urlOwnerId, urlFollowerId, urlNoFeedback, urlSignOff, urlIncomplete, urlPendingOpen, urlScope, localStatusFilter, localDepartmentFilter, localDateFrom, localDateTo, localSearch]);

  const filteredItems = useMemo(() => {
    const list = filterVisibleItems({ items, currentUser, orgUsers, roles, departments }).filter(item => {
      // 2. URL 参数过滤
      // 工作台跟进人下钻(scope=mine)：仅保留本人作为责任人和/或跟进人的事项，与首页卡片口径一致。
      // 即便跟进人另有组织/部门级数据范围(如兼任组织管理员 r5，范围被放大)，下钻条数也与首页卡片对应。
      if (urlScope === 'mine' && !isItemRelatedToUser(item, currentUser)) return false;

      if (urlStatusFilter) {
        const allowedStatuses = urlStatusFilter.split(',');
        // 责任人(ownerId=me)视角下钻：已超期/已完成改用用户级命中，与首页数字一一对应
        if (urlOwnerId === 'me' && (allowedStatuses.includes('OVERDUE') || allowedStatuses.includes('DELAYED'))) {
          if (!isUserWorkbenchItem('overdue', item, currentUser)) return false;
        } else if (urlOwnerId === 'me' && allowedStatuses.includes('COMPLETED')) {
          if (!isUserWorkbenchItem('completed', item, currentUser)) return false;
        } else if (!allowedStatuses.includes(getEffectiveItemStatus(item))) {
          return false;
        }
      }

      if (urlLightStatusFilter) {
        const allowedLights = urlLightStatusFilter.split(',');
        if (!item.lightStatus || !allowedLights.includes(item.lightStatus)) return false;
      }

      // 责任人(ownerId=me)视角下钻：与首页 person 模式口径一致，用 isItemOwnerForUser 裁剪范围
      if (urlOwnerId === 'me') {
        if (!isItemOwnerForUser(item, currentUser)) return false;
      } else if (resolvedOwnerId && item.ownerId !== resolvedOwnerId && !item.ownerIds?.includes(resolvedOwnerId)) {
        return false;
      }

      if (resolvedFollowerId && item.followerId !== resolvedFollowerId && !item.followerIds?.includes(resolvedFollowerId)) return false;

      if (urlNoFeedback === '1') {
        // 责任人(ownerId=me)视角下钻：用户级命中，与首页数字一一对应
        if (urlOwnerId === 'me') {
          if (!isUserWorkbenchItem('noFeedback', item, currentUser)) return false;
        } else if (!isWorkbenchNoFeedbackItem(item)) {
          return false;
        }
      }

      if (urlSignOff) {
        const so = item.signOffStatus || getItemSignOffStatus(item).status;
        if (so !== urlSignOff) return false;
      }

      if (urlIncomplete === '1') {
        // 责任人(ownerId=me)视角下钻：用户级命中，与首页数字一一对应
        if (urlOwnerId === 'me') {
          if (!isUserWorkbenchItem('incomplete', item, currentUser)) return false;
        } else if (!isWorkbenchIncompleteItem(item)) {
          return false;
        }
      }
      if (urlPendingOpen === '1') {
        // 责任人(ownerId=me)视角下钻：用户级命中（只看自己子任务未签收），与首页数字一一对应
        if (urlOwnerId === 'me') {
          if (!isUserWorkbenchItem('pendingOpen', item, currentUser)) return false;
        } else if (!isWorkbenchPendingOpenItem(item)) {
          return false;
        }
      }
      if (urlDueSoon === '1' && (!resolvedOwnerId || resolvedOwnerId !== currentUser.id || !isOwnerDueSoonItem(item, currentUser))) return false;
      if (urlOnTimeCompleted === '1' && (!resolvedOwnerId || resolvedOwnerId !== currentUser.id || !isOwnerOnTimeCompletedItem(item, currentUser))) return false;

      // 3. 本地筛选条件
      if (localStatusFilter && getEffectiveItemStatus(item) !== localStatusFilter) return false;

      if (localDepartmentFilter && !matchesDepartmentFilter({ item, departmentId: localDepartmentFilter, lookup: departmentFilterLookup })) return false;

      const normalizedDeadline = normalizeManualDateInput(item.deadline || '');
      if (localDateFrom && normalizedDeadline && normalizedDeadline < localDateFrom) return false;
      if (localDateTo && normalizedDeadline && normalizedDeadline > localDateTo) return false;

      // 4. 搜索
      const effectiveSearch = localSearch || searchTerm;
      if (effectiveSearch) {
        const q = effectiveSearch.toLowerCase();
        const followerNames = [
          ...(item.followerName ? [item.followerName] : []),
          ...(item.followerNames || []),
        ];
        const matches =
          item.title.toLowerCase().includes(q) ||
          item.serialNo.toLowerCase().includes(q) ||
          item.ownerName.toLowerCase().includes(q) ||
          followerNames.some((name) => name.toLowerCase().includes(q)) ||
          (item.meetingName || '').toLowerCase().includes(q);
        if (!matches) return false;
      }

      return true;
    });
    return [...list].sort(compareItemsByRaiseDateDesc);
  }, [items, currentUser, orgUsers, roles, departments, urlStatusFilter, urlLightStatusFilter, resolvedOwnerId, resolvedFollowerId, urlNoFeedback, urlDueSoon, urlOnTimeCompleted, urlScope, localStatusFilter, localDepartmentFilter, localDateFrom, localDateTo, localSearch, searchTerm, departmentFilterLookup]);
  const pagination = useMemo(
    () => paginateItems(filteredItems, page, pageSize),
    [filteredItems, page, pageSize],
  );

  useEffect(() => {
    if (page !== pagination.currentPage) {
      setPage(pagination.currentPage);
    }
  }, [page, pagination.currentPage]);

  const toggleSelectAll = () => {
    setSelectedIds(prev => prev.size === filteredItems.length ? new Set() : new Set(filteredItems.map(i => i.id)));
  };
  const allSelected = filteredItems.length > 0 && selectedIds.size === filteredItems.length;

  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'all' | 'filtered' | 'selected'>('all');
  const [exportFormat, setExportFormat] = useState<ItemExportFormat>('excel');
  const [exportFieldPreset, setExportFieldPreset] = useState<ItemExportFieldPreset>('all');

  const handleReportExport = () => {
    setExportScope('all');
    setIsExportOpen(true);
  };

  const resolveExportRows = () => {
    if (exportScope === 'selected') {
      return filteredItems.filter(i => selectedIds.has(i.id));
    }
    if (exportScope === 'filtered') {
      return filteredItems;
    }
    return filterVisibleItems({ items, currentUser, orgUsers, roles, departments });
  };

  const submitExport = () => {
    const exportRows = resolveExportRows();
    if (exportRows.length === 0) return;

    const config = buildItemExportConfig({
      filenameBase: exportScope === 'selected'
        ? '督办事项批量导出'
        : exportScope === 'filtered'
          ? '督办事项筛选报表'
          : '督办事项全量导出',
      format: exportFormat,
      fieldPreset: exportFieldPreset,
      rows: exportRows.map((row) => ({
        serialNo: row.serialNo,
        title: row.title,
        content: row.content,
        statusLabel: getItemStatusLabel(getEffectiveItemStatus(row)),
        deptNames: row.deptNames,
        ownerName: row.ownerName,
        followerName: row.followerName || '',
        meetingName: row.meetingName || row.meetingSource || '',
        raiseDate: row.raiseDate || '',
        deadline: formatDate(row.deadline),
        requiredCompletionDate: formatDate(row.requiredCompletionDate),
        plannedCompletionDate: formatDate(row.plannedCompletionDate),
        actualCompletionDate: formatDate(row.actualCompletionDate),
      })),
    });

    if (exportFormat === 'excel') {
      downloadExcel(config.filename, config.headers, config.rows);
    } else {
      downloadCsv(config.filename, config.headers, config.rows);
    }

    setIsExportOpen(false);
  };

  const [selectedItem, setSelectedItem] = useState<SupervisionItem | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // 按钮级权限按「事项列表」页面口径判定，与后端 X-Page-Auth=MENU_ITEMS 校验一致；
  // 角色配置页取消发起督办/删除事项后按钮隐藏，不再回退全局 allowedActions（含 EDIT_ITEM 旁路）。
  const canCreateItems = useMemo(
    () => canUsePageAction(currentUser, roles, 'MENU_ITEMS', 'CREATE_ITEM'),
    [currentUser, roles],
  );
  const canDeleteItems = useMemo(
    () => canUsePageAction(currentUser, roles, 'MENU_ITEMS', 'DELETE_ITEM'),
    [currentUser, roles],
  );
  const hasDeleteFallbackPrivilege = useMemo(
    () => currentUser.role === 'ADMIN' || getAssignedRoleIds(currentUser).includes('r5'),
    [currentUser],
  );
  const canExportItems = useMemo(
    () => canUsePageAction(currentUser, roles, 'MENU_ITEMS', 'EXPORT'),
    [currentUser, roles],
  );
  const canDeleteItemByIssuer = useCallback((item: SupervisionItem) => {
    const issuerIdentity = String(item.issuerAccount || item.issuerId || '').trim().toLowerCase();
    if (!issuerIdentity) return hasDeleteFallbackPrivilege;
    const currentIdentities = [currentUser.id, currentUser.name, currentUser.username]
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    return currentIdentities.includes(issuerIdentity) || hasDeleteFallbackPrivilege;
  }, [currentUser, hasDeleteFallbackPrivilege]);

  const handleRowClick = (item: SupervisionItem) => {
    setSelectedItem(item);
    setIsPreviewOpen(true);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('确定要将该督办事项移至回收站吗？')) {
      deleteItem(id, 'MENU_ITEMS');
      addLog({
        userName: currentUser.name,
        userId: currentUser.id,
        action: '事项删除',
        module: '督办事项'
      });
    }
  };

  const getStatusStyle = (status: string) => {
    return getItemStatusStyle(status);
  };

  const getStatusText = (status: string) => {
    return getItemStatusLabel(status);
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">督办事项列表</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-slate-500 text-sm">查看、筛选并管理全量督办台账。</p>
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                <Filter className="w-3 h-3" />
                已筛选 {activeFilterCount} 项条件
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {(hasUrlParams || hasLocalFilters) && (
            <button 
              onClick={() => { navigate('/items'); handleReset(); }}
              className="flex items-center gap-2 bg-slate-100 text-slate-600 px-4 py-2 rounded-lg font-semibold hover:bg-slate-200 transition-all text-sm"
            >
              <X className="w-4 h-4" />
              <span>清除筛选</span>
            </button>
          )}
          {canExportItems && (
            <button
              onClick={handleReportExport}
              className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-semibold hover:bg-slate-50 transition-all"
              title="导出当前可见的督办台账（可在弹窗中选择全量/当前筛选/已勾选项）"
            >
              <Download className="w-4 h-4" />
              <span>导出报表</span>
            </button>
          )}
          {/* 批量导出已合并至「导出报表」弹窗的“已勾选项”范围，避免功能重复 */}
          {/* 新建督办按钮已隐藏 */}
        </div>
      </div>

      <FilterPanel
        statusFilter={localStatusFilter}
        onStatusChange={setLocalStatusFilter}
        departmentFilter={localDepartmentFilter}
        onDepartmentChange={setLocalDepartmentFilter}
        dateFrom={localDateFrom}
        onDateFromChange={setLocalDateFrom}
        dateTo={localDateTo}
        onDateToChange={setLocalDateTo}
        localSearch={localSearch}
        onLocalSearchChange={setLocalSearch}
        onReset={handleReset}
        departmentOptions={scopedDepartmentOptions}
      />

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">
          共 <span className="font-bold text-slate-900">{filteredItems.length}</span> 条结果
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 text-slate-500 text-xs font-bold uppercase tracking-wider">
                <th className="px-3 py-4 w-10">
                  <button onClick={toggleSelectAll} className="p-1 rounded hover:bg-slate-200 transition-colors" title={allSelected ? '取消全选' : '全选'}>
                    {allSelected
                      ? <CheckSquare className="w-4 h-4 text-blue-600" />
                      : <Square className="w-4 h-4 text-slate-400" />}
                  </button>
                </th>
                <th className="px-6 py-4">督办序号</th>
                <th className="px-6 py-4">提出会议</th>
                <th className="px-6 py-4">督办跟进人员</th>
                <th className="px-6 py-4">提出时间</th>
                <th className="px-6 py-4">当前状态</th>
                <th className="px-6 py-4">负责人</th>
                <th className="px-6 py-4">签收状态</th>
                <th className="px-6 py-4">截止日期</th>
                <th className="px-6 py-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {pagination.rows.map((item) => {
                const subTasks = item.subTasks || [];
                const hasChildren = subTasks.length > 1;
                const isExpanded = expandedIds.has(item.id);
                const childRow = (st: typeof subTasks[number]) => (
                  <tr key={st.id} className="bg-slate-50/40 hover:bg-slate-100/60 group/child">
                    <td className="px-3 py-2"></td>
                    <td colSpan={8} className="px-6 py-2">
                      <div className="flex items-center gap-3 pl-6 text-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                        <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-medium px-2 py-0.5 rounded-lg">{st.assigneeName || '未指定责任人'}</span>
                        <span className="text-slate-400 text-xs shrink-0">计划完成</span>
                        <span className="text-slate-600 text-xs font-medium">{formatDate(st.plannedCompletionDate || st.deadline)}</span>
                        {st.requiredCompletionDate && (
                          <>
                            <span className="text-slate-400 text-xs shrink-0">要求完成</span>
                            <span className="text-slate-600 text-xs font-medium">{formatDate(st.requiredCompletionDate)}</span>
                          </>
                        )}
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${getStatusStyle(st.status)}`}>{getStatusText(st.status)}</span>
                        <span className="text-slate-400 text-xs shrink-0">进度 {st.progress ?? 0}%</span>
                        {st.actualCompletionDate && (
                          <span className="text-slate-400 text-xs shrink-0">实际完成 {formatDate(st.actualCompletionDate)}</span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/items/${item.id}`, { state: { from: '/items', label: '返回事项列表' } });
                          }}
                          className="ml-auto text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 shrink-0"
                        >
                          查看子任务 <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
                return (
                  <React.Fragment key={item.id}>
                    <tr
                      onClick={() => hasChildren ? toggleExpand(item.id) : handleRowClick(item)}
                      className={`group hover:bg-slate-50/50 transition-colors cursor-pointer ${selectedIds.has(item.id) ? 'bg-blue-50/60' : ''} ${hasChildren && isExpanded ? 'bg-slate-50/70' : ''}`}
                    >
                      <td className="px-3 py-4">
                        <button onClick={(e) => toggleSelect(e, item.id)} className="p-1 rounded hover:bg-slate-200 transition-colors">
                          {selectedIds.has(item.id)
                            ? <CheckSquare className="w-4 h-4 text-blue-600" />
                            : <Square className="w-4 h-4 text-slate-300" />}
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {hasChildren && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleExpand(item.id); }}
                              className="p-0.5 rounded hover:bg-slate-200 transition-colors text-slate-400"
                              title={isExpanded ? '收起子任务' : '展开子任务'}
                            >
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          )}
                          <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded font-mono">{item.serialNo}</span>
                          {item.lightStatus && (
                            <div className={`w-2 h-2 rounded-full shrink-0 ${
                              item.lightStatus === 'RED' ? 'bg-red-500' : 
                              item.lightStatus === 'YELLOW' ? 'bg-yellow-500' : 
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
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${getStatusStyle(getEffectiveItemStatus(item))}`}>
                          {getStatusText(getEffectiveItemStatus(item))}
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
                        {(() => {
                          const so = item.signOffStatus
                            ? { status: item.signOffStatus, signedCount: item.signedOwnerCount || 0, totalCount: item.totalOwnerCount || 0 }
                            : getItemSignOffStatus(item);
                          const multi = (so.totalCount || 0) > 1;
                          return (
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${getSignOffStatusStyle(so.status)}`}>
                              {getSignOffStatusLabel(so.status)}
                              {multi && <span className="opacity-75 font-medium">{so.signedCount}/{so.totalCount}</span>}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-slate-500">
                          <Calendar className="w-4 h-4" />
                          <span className="text-sm">{formatDate(item.requiredCompletionDate)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {canDeleteItems && canDeleteItemByIssuer(item) && (
                            <button 
                              onClick={(e) => handleDelete(e, item.id)}
                              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                              title="移至回收站"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/items/${item.id}`, { state: { from: '/items', label: '返回事项列表' } });
                            }}
                            className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                          >
                            详情 <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && hasChildren && subTasks.map(childRow)}
                  </React.Fragment>
                );
              })}
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
            onPageSizeChange={(nextPageSize) => {
              setPage(1);
              setPageSize(nextPageSize);
            }}
          />
        )}
      </div>

      {/* Preview Drawer */}
      <Drawer
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="事项预览"
        width="w-[480px]"
        footer={
          <div className="flex items-center gap-3">
                <button
                  onClick={() => navigate(`/items/${selectedItem?.id}`, { state: { from: '/items', label: '返回事项列表' } })}
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold hover:bg-blue-700 transition-all"
            >
              查看全量详情
            </button>
            {canDeleteItems && (
                  <button
                    onClick={() => navigate(`/items/${selectedItem?.id}?action=urge`, { state: { from: '/items', label: '返回事项列表' } })}
                className="flex-1 bg-white text-slate-700 border border-slate-200 py-2 rounded-lg font-bold hover:bg-slate-50 transition-all"
              >
                催办反馈
              </button>
            )}
          </div>
        }
      >
        {selectedItem && (
          <div className="space-y-8">
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-0.5 rounded">{selectedItem.serialNo}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${getStatusStyle(getEffectiveItemStatus(selectedItem))}`}>{getStatusText(getEffectiveItemStatus(selectedItem))}</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 leading-tight">{selectedItem.title}</h3>
              <p className="text-sm text-slate-500 mt-4 leading-relaxed">{selectedItem.content}</p>
            </section>

            <section className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 p-4 rounded-xl col-span-2">
                <p className="text-xs font-bold text-slate-400 uppercase mb-2">责任部门 / 责任人</p>
                <div className="space-y-1.5">
                  {(() => {
                    const depts = selectedItem.deptNames?.length ? selectedItem.deptNames : [ownerDeptMap[selectedItem.ownerId] || '院长办公室'];
                    const owners = selectedItem.ownerNames?.length ? selectedItem.ownerNames : (selectedItem.ownerName ? [selectedItem.ownerName] : ['-']);
                    const maxLen = Math.max(depts.length, owners.length);
                    return Array.from({ length: maxLen }, (_, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="font-semibold text-slate-900">{depts[i] || depts[0]}</span>
                        <span className="text-slate-300">·</span>
                        <span className="font-semibold text-slate-900">{owners[i] || owners[0]}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl">
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">提出时间</p>
                <p className="text-sm font-semibold text-slate-900">{formatDate(selectedItem.raiseDate)}</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl">
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">截止日期</p>
                <p className="text-sm font-semibold text-red-600">{formatDate(selectedItem.deadline)}</p>
              </div>
            </section>

            <section>
              <h4 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                <Zap className="w-4 h-4 text-orange-500" />
                最近动态
              </h4>
              <div className="space-y-4">
                {getUniqueTimeline(selectedItem.timeline).slice(-2).reverse().map((node, index) => (
                  <div key={`${node.id}-${node.timestamp}-${index}`} className="flex gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 shrink-0" />
                    <div>
                      <p className="text-sm text-slate-700 leading-snug">{node.content}</p>
                      <p className="text-xs text-slate-400 mt-1">{formatDate(node.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </Drawer>

      <CreateItemModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        pageAuth="MENU_ITEMS"
      />

      <Drawer
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        title="台账导出"
        footer={
          <div className="flex gap-3 justify-end">
            <button onClick={() => setIsExportOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
            <button onClick={submitExport} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all">导出</button>
          </div>
        }
      >
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">导出范围</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'all', label: '全量数据', disabled: false },
                { value: 'filtered', label: '当前筛选', disabled: false },
                { value: 'selected', label: selectedIds.size > 0 ? `已勾选项 (${selectedIds.size})` : '已勾选项', disabled: selectedIds.size === 0 },
              ] as const).map(option => (
                <button
                  key={option.value}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => !option.disabled && setExportScope(option.value as 'all' | 'filtered' | 'selected')}
                  className={`px-3 py-2 rounded-lg border text-sm font-semibold transition-all ${option.disabled ? 'border-slate-100 text-slate-300 cursor-not-allowed bg-slate-50' : exportScope === option.value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  title={option.disabled ? '请先在列表中勾选督办事项' : undefined}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">如需导出选中数据，请先在列表勾选事项，再选择「已勾选项」范围。</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">导出格式</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'excel', label: 'Excel' },
                { value: 'csv', label: 'CSV' },
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setExportFormat(option.value as ItemExportFormat)}
                  className={`px-3 py-2 rounded-lg border text-sm font-semibold transition-all ${exportFormat === option.value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">导出字段</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'all', label: '全部字段' },
                { value: 'summary', label: '摘要字段' },
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setExportFieldPreset(option.value as ItemExportFieldPreset)}
                  className={`px-3 py-2 rounded-lg border text-sm font-semibold transition-all ${exportFieldPreset === option.value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            当前将导出 {resolveExportRows().length} 条督办事项。
          </div>
        </div>
      </Drawer>
    </MainLayout>
  );
};

export default Items;
