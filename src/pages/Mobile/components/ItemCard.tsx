import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, ChevronRight, User } from 'lucide-react';
import { useStore } from '../../../store/useStore';
import type { SupervisionItem } from '../../../types';
import { getMobileItemStatus } from '../../../lib/item-format';
import { StatusBadge, PartialSignHint, LightBadge, getStatusMeta } from './StatusBadge';
import { RemainingDays } from './RemainingDays';

interface ItemCardProps {
  item: SupervisionItem;
  /** 快捷操作按钮文案（当前状态主操作），点击不跳详情 */
  actionLabel?: string;
  onAction?: (item: SupervisionItem) => void;
}

/** 事项列表卡片（待办/督办/首页共用，对应 UI 规范 4.2 节） */
export const ItemCard: React.FC<ItemCardProps> = ({ item, actionLabel, onAction }) => {
  const navigate = useNavigate();
  const { currentUser } = useStore();
  const status = getMobileItemStatus(item, currentUser);
  const meta = getStatusMeta(status);
  const ownerLabel = item.ownerNames?.length
    ? item.ownerNames.join('、')
    : item.ownerName || '-';

  return (
    <div
      className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm relative overflow-hidden active:scale-[0.99] transition-all"
      onClick={() => navigate(`/m/item/${item.id}`)}
    >
      {/* 状态色条：红灯事项加粗 */}
      <div className={`absolute left-0 top-0 bottom-0 ${item.lightStatus === 'RED' ? 'w-[5px]' : 'w-1'} ${meta.barCls}`} />

      <div className="flex items-start justify-between gap-4 pl-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-slate-400 uppercase">#{item.serialNo}</span>
            <StatusBadge item={item} />
            <PartialSignHint item={item} />
            <LightBadge lightStatus={item.lightStatus} />
          </div>
          <h4 className="text-sm font-bold text-slate-800 truncate">{item.title}</h4>
          <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-400 font-medium">
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" /> {ownerLabel}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" /> 截止 {item.requiredCompletionDate || item.deadline?.split(' ')[0] || '未设'}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <RemainingDays
            deadline={item.deadline}
            requiredCompletionDate={item.requiredCompletionDate}
            status={status}
          />
          {actionLabel && onAction ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAction(item);
              }}
              className="text-[11px] font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-all active:scale-95"
            >
              {actionLabel}
            </button>
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-300 mt-1" />
          )}
        </div>
      </div>
    </div>
  );
};
