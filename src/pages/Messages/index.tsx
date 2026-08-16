import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PaginationFooter } from '../../components/Common/PaginationFooter';
import { DEFAULT_PAGE_SIZE_OPTIONS, paginateItems } from '../../components/Common/pagination';
import { MainLayout } from '../../components/Layout/MainLayout';
import { formatDateTime } from '../../lib/item-format';
import { useStore, getVisibleMessages } from '../../store/useStore';
import { Message } from '../../types';
import { useToast } from '../../components/Common/Toast';
import { 
  Bell, 
  CheckCircle2, 
  Zap, 
  Search, 
  Trash2, 
  MailOpen, 
  ChevronRight,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type MessageTab = 'ALL' | 'TODO' | 'URGE' | 'NOTICE' | 'DONE';

const MessageCenter: React.FC = () => {
  const navigate = useNavigate();
  const { messages, markMessageRead, deleteMessage, deleteReadMessages, currentUser, items } = useStore();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<MessageTab>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [clearConfirm, setClearConfirm] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE_OPTIONS[0]);

  // 消息过滤：使用统一的消息可见性 helper（消息列表需展示「系统通知」分类，故 includeNotice）
  const visibleMessages = getVisibleMessages(messages, currentUser, items, { includeNotice: true });

  const filteredMessages = visibleMessages.filter((m) => {
    const matchesSearch =
      m.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.content.toLowerCase().includes(searchTerm.toLowerCase());
    if (activeTab === 'ALL') return matchesSearch;
    if (activeTab === 'DONE') return m.read && matchesSearch;
    // 待办/催办/通知分类：仅展示未读，已读消息统一归入「已读/已办」
    return m.type === activeTab && !m.read && matchesSearch;
  });

  // 按消息时间倒序排列（最新消息在最上面）
  const sortedMessages = useMemo(
    () => [...filteredMessages].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [filteredMessages],
  );
  const pagination = useMemo(
    () => paginateItems(sortedMessages, page, pageSize),
    [sortedMessages, page, pageSize],
  );

  const readCount = visibleMessages.filter(m => m.read).length;

  useEffect(() => {
    if (page !== pagination.currentPage) {
      setPage(pagination.currentPage);
    }
  }, [page, pagination.currentPage]);

  const handleMarkAllRead = () => {
    visibleMessages.forEach(m => {
      if (!m.read) markMessageRead(m.id);
    });
  };

  const handleClearRead = () => {
    if (readCount === 0) {
      showToast('没有已读消息可清理', 'info');
      return;
    }
    setClearConfirm(true);
  };

  const confirmClearRead = () => {
    deleteReadMessages();
    showToast(`已清理 ${readCount} 条已读消息`, 'success');
    setClearConfirm(false);
  };

  const handleDeleteMessage = (e: React.MouseEvent, msgId: string) => {
    e.stopPropagation();
    deleteMessage(msgId);
    showToast('消息已删除', 'success');
  };

  const openMessageDetail = (msg: Message) => {
    if (msg.link) {
      navigate(msg.link, { state: { messageId: msg.id, from: '/messages', label: '返回消息中心' } });
    }
  };

  const handleMessageClick = (msg: Message) => {
    openMessageDetail(msg);
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'TODO': return <CheckCircle2 className="w-5 h-5 text-blue-600" />;
      case 'URGE': return <Zap className="w-5 h-5 text-red-600" />;
      case 'NOTICE': return <Info className="w-5 h-5 text-amber-600" />;
      default: return <Bell className="w-5 h-5 text-slate-600" />;
    }
  };

  const getBg = (type: string) => {
    switch (type) {
      case 'TODO': return 'bg-blue-50';
      case 'URGE': return 'bg-red-50';
      case 'NOTICE': return 'bg-amber-50';
      default: return 'bg-slate-50';
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">消息中心</h1>
          <p className="text-slate-500 text-sm mt-1">处理您的待办任务、接收催办预警与系统通知。</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleMarkAllRead}
            className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-semibold hover:bg-slate-50 transition-all"
          >
            <MailOpen className="w-4 h-4" />
            <span>全部标记为已读</span>
          </button>
          <button 
            onClick={handleClearRead}
            disabled={readCount === 0}
            className="flex items-center gap-2 bg-white text-slate-600 border border-slate-200 px-4 py-2 rounded-lg font-semibold hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            title="清除所有已读消息"
          >
            <Trash2 className="w-4 h-4" />
            <span>清空已读{readCount > 0 ? ` (${readCount})` : ''}</span>
          </button>
        </div>
      </div>

      <div className="flex gap-8 h-[calc(100vh-200px)]">
        {/* Left Sidebar: Categories */}
        <div className="w-64 space-y-2">
          {([
            { id: 'ALL', label: '全部消息', icon: Bell, count: visibleMessages.filter(m => !m.read).length },
            { id: 'TODO', label: '待办任务', icon: CheckCircle2, count: visibleMessages.filter(m => m.type === 'TODO' && !m.read).length },
            { id: 'URGE', label: '催办预警', icon: Zap, count: visibleMessages.filter(m => m.type === 'URGE' && !m.read).length },
            { id: 'NOTICE', label: '系统通知', icon: Info, count: visibleMessages.filter(m => m.type === 'NOTICE' && !m.read).length },
            { id: 'DONE', label: '已读/已办', icon: MailOpen, count: readCount },
          ] satisfies { id: MessageTab; label: string; icon: typeof Bell; count: number }[]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all
                ${activeTab === tab.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'text-slate-600 hover:bg-white'}
              `}
            >
              <div className="flex items-center gap-3">
                <tab.icon className="w-5 h-5" />
                <span className="text-sm font-bold">{tab.label}</span>
              </div>
              {tab.count > 0 && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Right Content: Message List */}
        <div className="flex-1 bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-50">
            <div className="relative max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="搜索消息内容..."
                className="w-full bg-slate-50 border-none rounded-lg py-2 pl-10 pr-4 text-xs focus:ring-2 focus:ring-blue-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="divide-y divide-slate-50">
              <AnimatePresence mode="popLayout">
                {pagination.rows.map((msg, index) => (
                  <motion.div
                    key={msg.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => handleMessageClick(msg)}
                    className={`
                      p-6 flex items-start gap-4 cursor-pointer hover:bg-slate-50/50 transition-all group
                      ${!msg.read ? 'bg-blue-50/20' : ''}
                    `}
                  >
                    <div className={`w-12 h-12 rounded-2xl ${getBg(msg.type)} flex items-center justify-center shrink-0`}>
                      {getIcon(msg.type)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className={`text-sm font-bold ${!msg.read ? 'text-slate-900' : 'text-slate-600'}`}>
                          {msg.title}
                          {!msg.read && <span className="ml-2 w-1.5 h-1.5 bg-red-500 rounded-full inline-block" />}
                        </h4>
                        <span className="text-xs font-medium text-slate-400">{formatDateTime(msg.timestamp)}</span>
                      </div>
                      <p className="text-sm text-slate-500 leading-relaxed mb-4 line-clamp-2">
                        {msg.content}
                      </p>
                      
                      <div className="flex items-center justify-between">
                        {msg.link ? (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              openMessageDetail(msg);
                            }}
                            className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 bg-blue-50 px-3 py-1.5 rounded-lg transition-all"
                          >
                            立即处理
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <div />
                        )}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              markMessageRead(msg.id);
                            }}
                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-white rounded-lg transition-all" 
                            title="标记已读"
                          >
                            <MailOpen className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={(e) => handleDeleteMessage(e, msg.id)}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-white rounded-lg transition-all" 
                            title="删除消息"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {filteredMessages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 text-slate-300">
                  <Bell className="w-16 h-16 mb-4 opacity-20" />
                  <p className="text-sm font-bold">暂无相关消息</p>
                </div>
              )}
            </div>
          </div>
          {filteredMessages.length > 0 && (
            <PaginationFooter
              totalItems={filteredMessages.length}
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              pageSize={pageSize}
              pageSizeOptions={DEFAULT_PAGE_SIZE_OPTIONS}
              itemLabel="消息"
              onPageChange={setPage}
              onPageSizeChange={(nextPageSize) => {
                setPage(1);
                setPageSize(nextPageSize);
              }}
            />
          )}
        </div>
      </div>
      {/* 清空已读确认弹窗 */}
      {clearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setClearConfirm(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-8 w-[400px] max-w-[90vw]">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-red-500 shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">清空已读消息</h3>
                <p className="text-sm text-slate-500 mt-1">
                  将删除全部 <span className="font-semibold text-slate-700">{readCount} 条</span> 已读消息
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-400 mb-6">删除后不可恢复，未读消息将保留。</p>
            <div className="flex gap-3 justify-end">
              <button 
                onClick={() => setClearConfirm(false)} 
                className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors"
              >
                取消
              </button>
              <button 
                onClick={confirmClearRead} 
                className="px-5 py-2.5 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-colors"
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
};

export default MessageCenter;
