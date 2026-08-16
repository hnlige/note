import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCircle2, AlertCircle, Info, MessageSquare } from 'lucide-react';
import { useStore, getVisibleMessages, getUnreadVisibleMessageCount } from '../../store/useStore';
import { formatDateTime } from '../../lib/item-format';
import { motion, AnimatePresence } from 'framer-motion';
import type { Message } from '../../types';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ isOpen, onClose }) => {
  const { messages, markMessageRead, currentUser, items } = useStore();
  const navigate = useNavigate();

  // 过滤当前用户可见的消息
  const visibleMessages = getVisibleMessages(messages, currentUser, items);
  const unreadCount = getUnreadVisibleMessageCount(messages, currentUser, items);
  // 顶部下拉仅展示未读消息；进入具体详情页后才会标记已读并从列表消除。
  const unreadMessages = useMemo(() => visibleMessages.filter((message) => !message.read), [visibleMessages]);

  const handleMessageOpen = (message: Message) => {
    onClose();
    if (message.link) {
      navigate(message.link, { state: { messageId: message.id, from: '/messages', label: '返回消息中心' } });
      return;
    }
    navigate('/messages');
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'TODO': return <CheckCircle2 className="w-4 h-4 text-blue-600" />;
      case 'URGE': return <AlertCircle className="w-4 h-4 text-red-600" />;
      case 'NOTICE': return <Info className="w-4 h-4 text-slate-600" />;
      default: return <MessageSquare className="w-4 h-4 text-slate-600" />;
    }
  };

  const getBg = (type: string) => {
    switch (type) {
      case 'TODO': return 'bg-blue-50';
      case 'URGE': return 'bg-red-50';
      default: return 'bg-slate-50';
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-50 bg-slate-900/10 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute right-0 top-14 w-80 bg-white rounded-2xl shadow-xl border border-slate-100 z-[60] overflow-hidden"
          >
            <div className="p-4 border-b border-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">消息通知</h3>
                {unreadCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {unreadCount}
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  visibleMessages.filter((message) => !message.read).forEach((message) => markMessageRead(message.id));
                }}
                className="text-xs font-bold text-blue-600 hover:text-blue-700"
              >
                全部已读
              </button>
            </div>

            <div className="max-h-[400px] overflow-y-auto">
              {unreadMessages.length > 0 ? (
                <div className="divide-y divide-slate-50">
                  {unreadMessages.map(msg => (
                    <div 
                      key={msg.id}
                      className={`p-4 hover:bg-slate-50 transition-colors cursor-pointer relative ${!msg.read ? 'bg-blue-50/30' : ''}`}
                      onClick={() => handleMessageOpen(msg)}
                    >
                      <div className="flex gap-3">
                        <div className={`w-8 h-8 rounded-lg ${getBg(msg.type)} flex items-center justify-center shrink-0`}>
                          {getIcon(msg.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <p className="text-xs font-bold text-slate-900 truncate">{msg.title}</p>
                            <span className="text-[10px] text-slate-400">{formatDateTime(msg.timestamp)}</span>
                          </div>
                          <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                            {msg.content}
                          </p>
                        </div>
                      </div>
                      {!msg.read && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-blue-500 rounded-full" />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400">
                  <Bell className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-xs font-medium">暂无消息通知</p>
                </div>
              )}
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-100 text-center">
              <button
                onClick={() => {
                  onClose();
                  navigate('/messages');
                }}
                className="text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors"
              >
                查看全部消息
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
