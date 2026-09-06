import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { getEffectiveItemStatus, isItemFollowerForUser } from '../../lib/item-format';
import { getItemApprovalState } from '../../lib/item-approval';
import { MobileLayout } from './Layout';
import { ItemCard } from './components/ItemCard';
import { EmptyState, ListSkeleton } from './components/EmptyState';
import { Search } from 'lucide-react';
import type { ItemStatus, SupervisionItem } from '../../types';

type StatusFilter = 'ALL' | 'PENDING' | 'EXECUTING' | 'OVERDUE' | 'DELAYED' | 'COMPLETED';

const FILTER_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'PENDING', label: '待签收' },
  { key: 'EXECUTING', label: '执行中' },
  { key: 'OVERDUE', label: '已超时' },
  { key: 'DELAYED', label: '已延期' },
  { key: 'COMPLETED', label: '已完成' },
];

const CLOSED_STATUSES = new Set<ItemStatus>(['DELETED']);

/** 督办列表（跟进人视角："我跟进的"） */
export const MobileSupervision: React.FC = () => {
  const navigate = useNavigate();
  const { items, currentUser, orgUsers, syncItems } = useStore();
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    setLoading(true);
    syncItems().finally(() => setLoading(false));
  }, [syncItems]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return items
      .filter(item => {
        const approvalState = getItemApprovalState(item, currentUser, orgUsers);
        if (!isItemFollowerForUser(item, currentUser) && !approvalState.isFinalApprover) return false;
        const status = getEffectiveItemStatus(item);
        if (CLOSED_STATUSES.has(status)) return false;
        if (filter !== 'ALL' && status !== filter) return false;
        if (kw) {
          const matchTitle = item.title.toLowerCase().includes(kw);
          const matchNo = item.serialNo.toLowerCase().includes(kw);
          if (!matchTitle && !matchNo) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.deadline || b.raiseDate || 0).getTime() - new Date(a.deadline || a.raiseDate || 0).getTime());
  }, [items, currentUser, orgUsers, filter, keyword]);

  return (
    <MobileLayout title="督办列表">
      {/* 视图说明 */}
      <div className="bg-blue-50 rounded-xl px-4 py-2.5 mb-3">
        <p className="text-xs text-blue-700 font-medium">我跟进的（{filtered.length}）</p>
      </div>

      {/* 状态筛选 */}
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
        <EmptyState title="暂无跟进事项" description="您当前没有需要跟进的督办事项" />
      ) : (
        <>
          <div className="space-y-3">
            {filtered.map(item => {
              const status = getEffectiveItemStatus(item);
              const approval = getItemApprovalState(item, currentUser, orgUsers);
              const canApprove = status === 'REVIEWING' && approval.showApprovePanel && (approval.pendingFollowerApproval || approval.pendingFinalApproval);
              const canUrge = !['COMPLETED', 'ARCHIVED', 'DISABLED', 'SUSPENDED', 'NOT_SATISFIED', 'REVIEWING'].includes(status);
              return (
                <ItemCard
                  key={item.id}
                  item={item}
                  actionLabel={canApprove ? (approval.pendingFinalApproval ? '终审' : '审批') : canUrge ? '催办' : undefined}
                  onAction={(target) => navigate(`/m/item/${target.id}`, { state: { from: 'supervision', action: canApprove ? '审批通过' : '催办' } })}
                />
              );
            })}
          </div>
          <p className="text-center text-[10px] text-slate-400 mt-4">共 {filtered.length} 条</p>
        </>
      )}
    </MobileLayout>
  );
};

export default MobileSupervision;
