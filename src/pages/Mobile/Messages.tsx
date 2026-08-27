import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { api } from '../../lib/api';
import { useToast } from '../../components/Common/Toast';
import { MobileLayout } from './Layout';
import { EmptyState } from './components/EmptyState';
import { formatDateTime } from '../../lib/item-format';
import type { Message } from '../../types';
import { ClipboardCheck, Megaphone, FileText, Trash2, ChevronRight } from 'lucide-react';

type FilterType = 'ALL' | 'TODO' | 'URGE' | 'READ' | 'NOTICE';

const FILTER_TABS: { key: FilterType; label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'TODO', label: '待办' },
  { key: 'URGE', label: '催办' },
  { key: 'READ', label: '已读' },
  { key: 'NOTICE', label: '通知' },
];

/** 消息类型图标与配色 */
function messageIcon(type: Message['type']) {
  switch (type) {
    case 'TODO': return { icon: ClipboardCheck, cls: 'bg-blue-50 text-blue-600' };
    case 'URGE': return { icon: Megaphone, cls: 'bg-amber-50 text-amber-600' };
    default: return { icon: FileText, cls: 'bg-slate-50 text-slate-500' };
  }
}

export const MobileMessages: React.FC = () => {
  const navigate = useNavigate();
  const { messages, syncMessages } = useStore();
  const { showToast } = useToast();
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [loading, setLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);

  useEffect(() => {
    setLoading(true);
    syncMessages().finally(() => setLoading(false));
  }, [syncMessages]);

  const filtered = useMemo(() => {
    return messages.filter(m => {
      if (filter === 'TODO') return m.type === 'TODO';
      if (filter === 'URGE') return m.type === 'URGE';
      if (filter === 'READ') return m.read;
      if (filter === 'NOTICE') return m.type === 'NOTICE';
      return true;
    });
  }, [messages, filter]);

  // 筛选切换时重置分页
  useEffect(() => {
    setVisibleCount(20);
  }, [filter]);

  const unreadCount = messages.filter(m => !m.read).length;

  const handleMessageClick = async (msg: Message) => {
    // 标记已读
    if (!msg.read) {
      try {
        await api.messages.markRead(msg.id);
      } catch {
        // 标记失败不阻断跳转
      }
      syncMessages().catch(() => {});
    }
    // 跳转关联事项
    if (msg.link?.includes('/items/')) {
      const itemId = msg.link.split('/items/')[1];
      navigate(`/m/item/${itemId}`);
    } else if (msg.link) {
      window.open(msg.link, '_blank');
    }
  };

  const handleDelete = async (msg: Message) => {
    try {
      await api.messages.delete(msg.id);
      showToast('消息已删除', 'success');
      syncMessages().catch(() => {});
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败', 'error');
    }
  };

  return (
    <MobileLayout title={`消息中心${unreadCount > 0 ? ` (${unreadCount}条未读)` : ''}`}>
      {/* 筛选 Tab */}
      <div className="flex gap-1 mb-4">
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

      {/* 列表 */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm animate-pulse">
              <div className="h-4 w-1/2 bg-slate-100 rounded mb-2" />
              <div className="h-3 w-3/4 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title="暂无消息" description="当前筛选条件下没有消息" />
      ) : (
        <>
          <div className="space-y-3">
            {filtered.slice(0, visibleCount).map(msg => {
            const { icon: Icon, cls } = messageIcon(msg.type);
            return (
              <div
                key={msg.id}
                className={`bg-white rounded-2xl border p-4 shadow-sm relative overflow-hidden transition-all ${
                  !msg.read ? 'border-blue-100' : 'border-slate-100'
                }`}
              >
                {!msg.read && <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500" />}
                <div className="flex items-start gap-3 pl-1">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${cls}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0" onClick={() => handleMessageClick(msg)}>
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-bold text-slate-800 truncate">{msg.title}</h4>
                      {!msg.read && <span className="shrink-0 w-2 h-2 rounded-full bg-red-500" />}
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-2">{msg.content}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-slate-400">{formatDateTime(msg.timestamp)}</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(msg); }}
                          className="text-slate-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        {msg.link && (
                          <span className="flex items-center gap-0.5 text-[11px] font-bold text-blue-600">
                            点击处理 <ChevronRight className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          </div>
          {visibleCount < filtered.length ? (
            <button
              onClick={() => setVisibleCount(c => c + 20)}
              className="w-full bg-white border border-slate-100 rounded-xl py-3 text-sm font-bold text-blue-600 active:bg-slate-50 transition-colors"
            >
              加载更多（已显示 {Math.min(visibleCount, filtered.length)}/{filtered.length}）
            </button>
          ) : (
            <p className="text-center text-[10px] text-slate-400 mt-4">共 {filtered.length} 条消息</p>
          )}
        </>
      )}
    </MobileLayout>
  );
};

export default MobileMessages;
