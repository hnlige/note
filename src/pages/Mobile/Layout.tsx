import React, { useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { getMobileItemStatus, isItemRelatedToUser } from '../../lib/item-format';
import { Home, ClipboardCheck, Eye, MessageCircle, User } from 'lucide-react';

interface MobileLayoutProps {
  children: React.ReactNode;
  title?: string;
}

/** 底部 Tab 角标与可见性共用派生逻辑：待办数（当前用户相关非终态）+ 未读消息数 */
export function useMobileTabBadges() {
  const { items, currentUser, messages } = useStore();
  return useMemo(() => {
    let todoCount = 0;
    for (const item of items) {
      const status = getMobileItemStatus(item, currentUser);
      const closed = ['COMPLETED', 'ARCHIVED', 'DISABLED', 'DELETED', 'NOT_SATISFIED'].includes(status);
      if (!closed && isItemRelatedToUser(item, currentUser)) todoCount++;
    }
    const unreadCount = messages.filter(m => !m.read).length;
    return { todoCount, unreadCount };
  }, [items, currentUser, messages]);
}

export const MobileLayout: React.FC<MobileLayoutProps> = ({ children, title = '督办事项' }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, syncItems, syncMessages } = useStore();
  const { todoCount, unreadCount } = useMobileTabBadges();

  // Tab 数据与角标保持新鲜：进入任意移动端页面时静默刷新
  useEffect(() => {
    syncItems().catch(() => {});
    syncMessages().catch(() => {});
  }, [syncItems, syncMessages]);

  const isFollowerOnly = currentUser.role === 'FOLLOWER';
  const isOwnerOnly = currentUser.role === 'OWNER';

  const tabs = [
    { id: 'home', label: '首页', path: '/m/home', icon: Home, badge: 0, visible: true },
    { id: 'todo', label: '待办', path: '/m/todo', icon: ClipboardCheck, badge: todoCount, visible: !isFollowerOnly },
    { id: 'supervision', label: '督办', path: '/m/supervision', icon: Eye, badge: 0, visible: !isOwnerOnly },
    { id: 'messages', label: '消息', path: '/m/messages', icon: MessageCircle, badge: unreadCount, visible: true },
    { id: 'mine', label: '我的', path: '/m/mine', icon: User, badge: 0, visible: true },
  ].filter(tab => tab.visible);

  // 详情页有自己的固定操作栏，避免与底部 Tab 栏重叠遮挡
  const isItemDetail = location.pathname.startsWith('/m/item/');
  if (isItemDetail) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col max-w-md mx-auto relative shadow-xl border-x border-slate-100">
        <header
          className="sticky top-0 z-50 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between"
          style={{ paddingTop: 'calc(12px + env(safe-area-inset-top))' }}
        >
          <h1 className="text-base font-bold text-slate-800">{title}</h1>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-[10px] text-white font-bold">
              {currentUser.name?.slice(-2) || '员工'}
            </div>
            <span className="text-xs text-slate-500 font-medium">{currentUser.name}</span>
          </div>
        </header>
        <main className="flex-1 px-4 pt-4">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col max-w-md mx-auto relative shadow-xl border-x border-slate-100">
      {/* 头部导航栏 */}
      <header
        className="sticky top-0 z-50 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between"
        style={{ paddingTop: 'calc(12px + env(safe-area-inset-top))' }}
      >
        <h1 className="text-base font-bold text-slate-800">{title}</h1>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-[10px] text-white font-bold">
            {currentUser.name?.slice(-2) || '员工'}
          </div>
          <span className="text-xs text-slate-500 font-medium">{currentUser.name}</span>
        </div>
      </header>

      {/* 主体内容区 */}
      <main className="flex-1 pb-24 overflow-y-auto px-4 pt-4">
        {children}
      </main>

      {/* 底部 Tab 栏 */}
      <nav
        className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t border-slate-100 py-2 px-1 flex items-center justify-around z-40 shadow-[0_-2px_10px_rgba(0,0,0,0.02)]"
        style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom))' }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = location.pathname === tab.path || (tab.id === 'todo' && location.pathname.startsWith('/m/item/') && location.state?.from === 'todo');
          return (
            <button
              key={tab.id}
              onClick={() => navigate(tab.path)}
              className={`relative flex flex-col items-center gap-1 flex-1 py-1 transition-all active:scale-95 ${
                isActive ? 'text-blue-600 font-bold' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="w-5 h-5" />
              {tab.badge > 0 && (
                <span className="absolute top-0 right-[22%] min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
              <span className="text-[10px] tracking-wide">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default MobileLayout;
