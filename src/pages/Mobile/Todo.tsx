import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { getMobileItemStatus, isItemRelatedToUser, isItemOwnerForUser } from '../../lib/item-format';
import { filterItemsByMobileTab, getMobileHomeTabTitle } from '../../lib/mobile-home-metrics';
import type { WorkbenchMetricKey } from '../../pages/Workbench/components/workbench-metrics';
import { MobileLayout } from './Layout';
import { ItemCard } from './components/ItemCard';
import { EmptyState, ListSkeleton } from './components/EmptyState';
import { Search } from 'lucide-react';
import type { ItemStatus, SupervisionItem } from '../../types';

type StatusFilter = 'ALL' | 'PENDING' | 'EXECUTING' | 'DELAYED' | 'OVERDUE' | 'REVIEWING';

const FILTER_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'PENDING', label: '待签收' },
  { key: 'EXECUTING', label: '执行中' },
  { key: 'DELAYED', label: '已延期' },
  { key: 'OVERDUE', label: '已超时' },
  { key: 'REVIEWING', label: '待审批' },
];

const CLOSED_STATUSES = new Set<ItemStatus>(['COMPLETED', 'ARCHIVED', 'DISABLED', 'DELETED', 'NOT_SATISFIED']);

/** 按状态给出卡片快捷操作文案（责任人视角主操作） */
function quickActionFor(
  item: SupervisionItem,
  user: Pick<import('../../types').User, 'id' | 'name' | 'username'>,
  isOwner: boolean,
): string | undefined {
  const status = getMobileItemStatus(item, user);
  if (!isOwner) return undefined;
  switch (status) {
    case 'PENDING': return '签收';
    case 'EXECUTING': return '申请完成';
    case 'OVERDUE': return '申请延期';
    case 'DELAYED': return '申请完成';
    default: return undefined;
  }
}

/** 从路由 state 中读取首页标签下钻参数 */
function readHomeTabFromState(state: unknown): WorkbenchMetricKey | null {
  const tab = (state as { tab?: unknown } | null)?.tab;
  return typeof tab === 'string' ? (tab as WorkbenchMetricKey) : null;
}

export const MobileTodo: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { items, currentUser, orgUsers, roles, departments, syncItems } = useStore();
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  // 首页顶部标签下钻：与对应标签计数完全同口径的语义筛选
  const [semanticTab, setSemanticTab] = useState<WorkbenchMetricKey | null>(() => readHomeTabFromState(location.state));
  const [lastDrillNavKey, setLastDrillNavKey] = useState<string | null>(
    readHomeTabFromState(location.state) ? location.key : null,
  );

  // 首页再次下钻（即使同一标签）也重置列表与已有筛选
  useEffect(() => {
    const homeTab = readHomeTabFromState(location.state);
    if (!homeTab || lastDrillNavKey === location.key) return;
    setLastDrillNavKey(location.key);
    setSemanticTab(homeTab);
    setFilter('ALL');
    setKeyword('');
  }, [location, lastDrillNavKey]);

  React.useEffect(() => {
    setLoading(true);
    syncItems().finally(() => setLoading(false));
  }, [syncItems]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();

    const scoped =
      semanticTab !== null
        ? filterItemsByMobileTab(semanticTab, { items, currentUser, orgUsers, roles, departments })
        : items.filter(item => {
            if (!isItemRelatedToUser(item, currentUser)) return false;
            const status = getMobileItemStatus(item, currentUser);
            if (CLOSED_STATUSES.has(status)) return false;
            if (filter !== 'ALL' && status !== filter) return false;
            return true;
          });

    return scoped
      .filter(item => {
        if (kw) {
          const matchTitle = item.title.toLowerCase().includes(kw);
          const matchNo = item.serialNo.toLowerCase().includes(kw);
          if (!matchTitle && !matchNo) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // 超期优先，再按剩余天数升序
        const sa = getMobileItemStatus(a, currentUser);
        const sb = getMobileItemStatus(b, currentUser);
        const aOverdue = sa === 'OVERDUE' || sa === 'DELAYED' ? 0 : 1;
        const bOverdue = sb === 'OVERDUE' || sb === 'DELAYED' ? 0 : 1;
        if (aOverdue !== bOverdue) return aOverdue - bOverdue;
        const aDays = a.deadline ? new Date(a.deadline).getTime() : Infinity;
        const bDays = b.deadline ? new Date(b.deadline).getTime() : Infinity;
        return aDays - bDays;
      });
  }, [items, currentUser, orgUsers, roles, departments, filter, keyword, semanticTab]);

  const handleQuickAction = (item: SupervisionItem) => {
    const action = getMobileItemStatus(item, currentUser) === 'REVIEWING'
      ? '审批通过'
      : quickActionFor(item, currentUser, isItemOwnerForUser(item, currentUser));
    navigate(`/m/item/${item.id}`, { state: { from: 'todo', action } });
  };

  return (
    <MobileLayout title="待办中心">
      {/* 首页标签下钻提示 */}
      {semanticTab !== null && (
        <div className="mb-3 flex items-center justify-between bg-blue-50 rounded-xl px-4 py-2.5">
          <p className="text-xs text-blue-700 font-medium truncate">已按首页「{getMobileHomeTabTitle(semanticTab)}」筛选，条数与首页一致</p>
          <button onClick={() => setSemanticTab(null)} className="text-xs text-blue-600 font-bold shrink-0 ml-2">
            查看全部
          </button>
        </div>
      )}

      {/* 状态筛选 Tab（首页标签下钻时隐藏，避免双重筛选） */}
      {semanticTab === null && (
        <div className="flex gap-1 mb-3">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex-1 px-2 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                filter === tab.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-500 border border-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* 搜索框 */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索事项编号或标题..."
          className="w-full bg-white border border-slate-100 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>

      {/* 列表 */}
      {loading ? (
        <ListSkeleton count={4} />
      ) : filtered.length === 0 ? (
        <EmptyState title="暂无待办事项" description="当前筛选条件下没有待办" />
      ) : (
        <>
          <div className="space-y-3">
            {filtered.map(item => (
              <ItemCard
                key={item.id}
                item={item}
                actionLabel={quickActionFor(item, currentUser, isItemOwnerForUser(item, currentUser))}
                onAction={handleQuickAction}
              />
            ))}
          </div>
          <p className="text-center text-[10px] text-slate-400 mt-4">共 {filtered.length} 条</p>
        </>
      )}
    </MobileLayout>
  );
};

export default MobileTodo;
