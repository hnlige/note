import React from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title = '暂无数据',
  description,
  icon,
}) => (
  <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center flex flex-col items-center justify-center shadow-sm">
    <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 mb-3">
      {icon || <Inbox className="w-6 h-6" />}
    </div>
    <p className="text-sm text-slate-400 font-medium">{title}</p>
    {description && <p className="text-xs text-slate-400 mt-1">{description}</p>}
  </div>
);

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({ message = '加载失败', onRetry }) => (
  <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center flex flex-col items-center justify-center shadow-sm">
    <p className="text-sm text-slate-500 font-medium mb-3">{message}</p>
    {onRetry && (
      <button
        onClick={onRetry}
        className="px-4 py-2 text-xs font-bold text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-all"
      >
        重试
      </button>
    )}
  </div>
);

/** 骨架屏占位（与卡片尺寸一致，避免加载后跳动） */
export const CardSkeleton: React.FC = () => (
  <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm animate-pulse">
    <div className="flex items-center gap-2 mb-2">
      <div className="h-3 w-16 bg-slate-100 rounded" />
      <div className="h-3 w-14 bg-slate-100 rounded" />
    </div>
    <div className="h-4 w-3/4 bg-slate-100 rounded mb-3" />
    <div className="h-3 w-1/2 bg-slate-100 rounded" />
  </div>
);

export const ListSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="space-y-3">
    {Array.from({ length: count }).map((_, i) => (
      <CardSkeleton key={i} />
    ))}
  </div>
);
