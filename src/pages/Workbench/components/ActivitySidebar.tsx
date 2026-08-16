import React from 'react';
import { useStore } from '../../../store/useStore';
import { formatDateTime } from '../../../lib/item-format';
import { motion } from 'framer-motion';
import { MessageSquare, Zap, RefreshCw, Info } from 'lucide-react';

export const ActivitySidebar: React.FC = () => {
  const { activities } = useStore();

  const getIcon = (type: string) => {
    switch (type) {
      case 'FEEDBACK': return <MessageSquare className="w-4 h-4 text-blue-600" />;
      case 'URGE': return <Zap className="w-4 h-4 text-red-600" />;
      case 'STATUS_CHANGE': return <RefreshCw className="w-4 h-4 text-orange-600" />;
      case 'SYSTEM': return <Info className="w-4 h-4 text-slate-600" />;
      default: return <Info className="w-4 h-4 text-slate-600" />;
    }
  };

  const getBg = (type: string) => {
    switch (type) {
      case 'FEEDBACK': return 'bg-blue-50';
      case 'URGE': return 'bg-red-50';
      case 'STATUS_CHANGE': return 'bg-orange-50';
      case 'SYSTEM': return 'bg-slate-50';
      default: return 'bg-slate-50';
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <h3 className="text-lg font-bold text-slate-900 mb-4">最新动态</h3>
        <div className="space-y-4">
          {activities.map((activity, index) => (
            <motion.div
              key={activity.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 + index * 0.1 }}
              className="flex gap-3 relative pb-4 last:pb-0"
            >
              {index !== activities.length - 1 && (
                <div className="absolute left-[15px] top-[30px] bottom-0 w-[1px] bg-slate-100" />
              )}
              <div className={`w-8 h-8 rounded-full ${getBg(activity.type)} flex items-center justify-center flex-shrink-0 z-10`}>
                {getIcon(activity.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700 leading-snug break-words">{activity.content}</p>
                <p className="text-xs text-slate-400 mt-1">{formatDateTime(activity.timestamp)}</p>
              </div>
            </motion.div>
          ))}
        </div>
        <button className="w-full mt-6 py-2 text-sm font-semibold text-slate-500 hover:text-slate-900 transition-colors border-t border-slate-50 pt-4">
          查看全部动态
        </button>
      </div>
    </div>
  );
};
