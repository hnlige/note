import React from 'react';
import { ItemStatus } from '../../../types';
import { getEffectiveItemStatus } from '../../../lib/item-format';
import type { SupervisionItem } from '../../../types';

/** 状态标签配色（对应 docs/移动端UI设计规范_v2.md 第 3 节，10 个枚举全覆盖） */
const STATUS_META: Record<ItemStatus, { label: string; cls: string; barCls: string }> = {
  PENDING: { label: '待签收', cls: 'bg-amber-50 text-amber-600 border-amber-200', barCls: 'bg-amber-500' },
  EXECUTING: { label: '执行中', cls: 'bg-blue-50 text-blue-600 border-blue-200', barCls: 'bg-blue-500' },
  OVERDUE: { label: '已超时', cls: 'bg-red-50 text-red-600 border-red-200', barCls: 'bg-red-500' },
  DELAYED: { label: '已延期', cls: 'bg-red-50 text-red-600 border-red-200', barCls: 'bg-red-500' },
  REVIEWING: { label: '待审批完成', cls: 'bg-amber-50 text-amber-600 border-amber-200', barCls: 'bg-amber-500' },
  SUSPENDED: { label: '已暂缓', cls: 'bg-slate-100 text-slate-500 border-slate-200', barCls: 'bg-slate-400' },
  COMPLETED: { label: '已正常完成', cls: 'bg-green-50 text-green-600 border-green-200', barCls: 'bg-green-500' },
  ARCHIVED: { label: '已归档', cls: 'bg-slate-100 text-slate-500 border-slate-200', barCls: 'bg-slate-400' },
  DELETED: { label: '已删除', cls: 'bg-slate-100 text-slate-500 border-slate-200', barCls: 'bg-slate-400' },
  DISABLED: { label: '已废弃', cls: 'bg-slate-100 text-slate-500 border-slate-200', barCls: 'bg-slate-400' },
  NOT_SATISFIED: { label: '未按要求完成', cls: 'bg-red-50 text-red-600 border-red-200', barCls: 'bg-red-500' },
};

export function getStatusMeta(status: ItemStatus) {
  return STATUS_META[status] || STATUS_META.EXECUTING;
}

interface StatusBadgeProps {
  /** 直接传事项时取 effectiveStatus（后端权威状态） */
  item?: SupervisionItem;
  status?: ItemStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, item }) => {
  const effective = item ? getEffectiveItemStatus(item) : (status || 'EXECUTING');
  const meta = getStatusMeta(effective);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded border ${meta.cls}`}>
      {meta.label}
    </span>
  );
};

interface PartialSignHintProps {
  item: SupervisionItem;
}

/** 多责任人部分签收提示：N/M 已签 */
export const PartialSignHint: React.FC<PartialSignHintProps> = ({ item }) => {
  if (item.signOffStatus !== 'PARTIAL') return null;
  return (
    <span className="text-[10px] text-slate-500 font-medium ml-1">
      {item.signedOwnerCount ?? 0}/{item.totalOwnerCount ?? 0} 已签
    </span>
  );
};

interface LightBadgeProps {
  lightStatus?: 'RED' | 'YELLOW' | 'GREEN';
}

export const LightBadge: React.FC<LightBadgeProps> = ({ lightStatus }) => {
  if (!lightStatus || lightStatus === 'GREEN') return null;
  return lightStatus === 'RED' ? (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-50 text-red-600 border border-red-200">🔴 红灯</span>
  ) : (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-50 text-amber-600 border border-amber-200">🟡 黄灯</span>
  );
};
