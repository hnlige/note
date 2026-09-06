import React from 'react';
import { Flame } from 'lucide-react';
import { computeRemainingDays } from '../../../lib/remaining-days';

interface RemainingDaysProps {
  deadline?: string;
  requiredCompletionDate?: string;
  status?: string;
}

/** 剩余天数 pill（列表/看板/详情三处统一配色，对应 UI 规范 3 节剩余天数色阶） */
export const RemainingDays: React.FC<RemainingDaysProps> = ({ deadline, requiredCompletionDate, status }) => {
  const result = computeRemainingDays({ deadline, requiredCompletionDate, status });

  if (result.kind === 'none') {
    return <span className="text-xs font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">未设截止</span>;
  }
  if (result.kind === 'overdue') {
    return (
      <div className="flex items-center gap-1 text-red-600 font-bold text-xs bg-red-50 px-2.5 py-1 rounded-xl">
        <Flame className="w-3.5 h-3.5 fill-red-500" />
        <span>超期 {result.days} 天</span>
      </div>
    );
  }
  if (result.days <= 3) {
    return <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">剩 {result.days} 天</span>;
  }
  return <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-lg">剩 {result.days} 天</span>;
};
