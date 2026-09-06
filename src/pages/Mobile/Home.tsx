import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { hasAuthToken } from '../../lib/api';
import { buildMobileHomeTabs } from '../../lib/mobile-home-metrics';
import { shouldShowRecentActivity } from '../../lib/recent-activity-visibility';
import { getMobileItemStatus, isItemRelatedToUser } from '../../lib/item-format';
import { MobileLayout } from './Layout';
import { ItemCard } from './components/ItemCard';
import { Sparkles, Zap, ChevronRight, BellRing, Megaphone, ClipboardCheck } from 'lucide-react';
import type { Message } from '../../types';

/** 五个顶部标签的数字颜色（与 PC 工作台指标卡同色系） */
const TAB_VALUE_COLORS: Record<string, string> = {
  pendingOpen: 'text-blue-600',
  overdue: 'text-red-500',
  noFeedback: 'text-orange-500',
  incomplete: 'text-purple-600',
  completed: 'text-emerald-600',
};

/** 最近动态条目：由消息记录派生，点击跳转对应事项或消息中心 */
interface RecentActivity {
  key: string;
  icon: 'urge' | 'todo' | 'notice';
  title: string;
  detail: string;
  timestamp: string;
  itemId?: string;
}

const parseItemIdFromLink = (link?: string): string | undefined => {
  const match = link?.match(/\/items\/([^/?#]+)/);
  return match?.[1];
};

const toRecentActivity = (msg: Message): RecentActivity => {
  const type = msg.type === 'URGE' ? 'urge' : msg.type === 'TODO' ? 'todo' : 'notice';
  return {
    key: msg.id,
    icon: type,
    title: msg.title,
    detail: msg.content,
    timestamp: msg.timestamp,
    itemId: parseItemIdFromLink(msg.link),
  };
};

export const MobileHome: React.FC = () => {
  const navigate = useNavigate();
  const { items, currentUser, roles, orgUsers, departments, messages, syncItems, syncMessages } = useStore();

  useEffect(() => {
    if (!hasAuthToken()) {
      window.location.replace('/m/login');
      return;
    }
    syncItems().catch((err) => console.error('Sync items error:', err));
    syncMessages().catch((err) => console.error('Sync messages error:', err));
  }, [syncItems, syncMessages]);

  // 首页顶部标签：与 PC 工作台五态指标同口径，所有角色标签集合一致
  const tabs = useMemo(
    () => buildMobileHomeTabs({ items, currentUser, orgUsers, roles, departments }),
    [items, currentUser, orgUsers, roles, departments],
  );
  const incompleteCount = tabs.find(tab => tab.key === 'incomplete')?.value ?? 0;

  // 高频待办 Top5
  const todayTodos = useMemo(() => {
    const now = new Date();
    return items
      .filter(item => {
        const isRelated = isItemRelatedToUser(item, currentUser);
        const status = getMobileItemStatus(item, currentUser);
        const closed = ['COMPLETED', 'ARCHIVED', 'DISABLED', 'DELETED', 'NOT_SATISFIED'].includes(status);
        return isRelated && !closed;
      })
      .map(item => {
        const remainingDays = item.deadline
          ? Math.ceil((new Date(item.deadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          : null;
        return { ...item, remainingDays };
      })
      .sort((a, b) => (a.remainingDays ?? Infinity) - (b.remainingDays ?? Infinity))
      .slice(0, 5);
  }, [items, currentUser]);

  // 最近动态：最新 3 条消息（未读优先），点击跳对应事项。
  // 超级管理员、督办责任人、督办跟进人、督办管理员、部门管理员不展示该模块。
  const showRecentActivity = shouldShowRecentActivity(currentUser, roles);
  const recentActivities = useMemo<RecentActivity[]>(
    () =>
      showRecentActivity
        ? [...messages]
            .sort((a, b) => {
              if (a.read !== b.read) return a.read ? 1 : -1;
              return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
            })
            .slice(0, 3)
            .map(toRecentActivity)
        : [],
    [messages, showRecentActivity],
  );

  return (
    <MobileLayout title="督办门户">
      {/* 欢迎模块 */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-2xl p-5 mb-5 shadow-md relative overflow-hidden">
        <div className="absolute right-[-10px] bottom-[-10px] opacity-10">
          <Sparkles className="w-32 h-32" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-amber-300 fill-amber-300" />
            <span className="text-xs text-blue-100 font-bold tracking-wider uppercase">MOBILE PORTAL</span>
          </div>
          <h2 className="text-lg font-bold">您好，{currentUser.name}</h2>
          <p className="text-xs text-blue-100 mt-1">今天有 {incompleteCount} 个督办待办，请按时完成签收与反馈。</p>
        </div>
      </div>

      {/* 顶部标签：待签收/已超期/未反馈/未完成/已完成（全角色统一，点击下钻待办中心同口径列表） */}
      <div className="grid grid-cols-5 gap-2 mb-6">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => navigate('/m/todo', { state: { tab: tab.key } })}
            className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center text-center active:scale-95 transition-all"
          >
            <span className={`text-xl font-black ${TAB_VALUE_COLORS[tab.key] || 'text-slate-700'}`}>{tab.value}</span>
            <span className="text-[10px] text-slate-400 font-bold mt-1 whitespace-nowrap">{tab.title}</span>
          </button>
        ))}
      </div>

      {/* 最近动态：最新消息条目，点击跳对应事项或消息中心（五类管理/经办角色不展示） */}
      {showRecentActivity && (
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">最近动态</h3>
          <button onClick={() => navigate('/m/messages')} className="text-[10px] text-blue-600 font-bold flex items-center gap-0.5">
            全部消息 <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        {recentActivities.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center shadow-sm">
            <p className="text-sm text-slate-400 font-medium">暂无新消息</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-50">
            {recentActivities.map(act => {
              const Icon = act.icon === 'urge' ? BellRing : act.icon === 'todo' ? ClipboardCheck : Megaphone;
              const iconColor = act.icon === 'urge' ? 'text-red-600 bg-red-50' : act.icon === 'todo' ? 'text-blue-600 bg-blue-50' : 'text-amber-600 bg-amber-50';
              return (
                <button
                  key={act.key}
                  onClick={() => navigate(act.itemId ? `/m/item/${act.itemId}` : '/m/messages')}
                  className="w-full flex items-center gap-3 p-3 active:bg-slate-50 transition-colors text-left"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconColor}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{act.title}</p>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">{act.detail}</p>
                  </div>
                  <span className="text-[10px] text-slate-300 shrink-0">{act.timestamp.slice(5, 10)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* 高频待办事项列表（卡片可点击进详情） */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">高频待办事项</h3>
          <button onClick={() => navigate('/m/todo')} className="text-[10px] text-blue-600 font-bold flex items-center gap-0.5">
            查看全部 <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        {todayTodos.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center flex flex-col items-center justify-center shadow-sm">
            <p className="text-sm text-slate-400 font-medium">暂无督办待办，安心度过今天</p>
          </div>
        ) : (
          <div className="space-y-3">
            {todayTodos.map(item => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </MobileLayout>
  );
};

export default MobileHome;
