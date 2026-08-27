import React from 'react';
import { Flame } from 'lucide-react';

interface RemainingDaysProps {
  deadline?: string;
  status?: string;
}

/** 剩余天数 pill（列表/看板/详情三处统一配色，对应 UI 规范 3 节剩余天数色阶） */
export const RemainingDays: React.FC<RemainingDaysProps> = ({ deadline, status }) => {
  if (!deadline) {
    return <span className="text-xs font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">未设截止</span>;
  }
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(deadline);
  due.setHours(0, 0, 0, 0);
  const diff = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  // 已超期或已延期/已超时状态
  if (diff < 0 || status === 'OVERDUE' || status === 'DELAYED') {
    return (
      <div className="flex items-center gap-1 text-red-600 font-bold text-xs bg-red-50 px-2.5 py-1 rounded-xl">
        <Flame className="w-3.5 h-3.5 fill-red-500" />
        <span>超期 {Math.abs(diff)} 天</span>
      </div>
    );
  }
  if (diff === 0) {
    return <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">今天到期</span>;
  }
  if (diff <= 3) {
    return <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">剩 {diff} 天</span>;
  }
  return <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-lg">剩 {diff} 天</span>;
};
