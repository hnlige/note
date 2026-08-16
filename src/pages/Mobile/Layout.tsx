import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { 
  Home, 
  ClipboardCheck, 
  Eye, 
  MessageCircle, 
  User,
  AlertCircle
} from 'lucide-react';

interface MobileLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export const MobileLayout: React.FC<MobileLayoutProps> = ({ children, title = '督办事项' }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useStore();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const tabs = [
    { id: 'home', label: '首页', path: '/m/home', icon: Home, enabled: true },
    { id: 'todo', label: '待办', path: '/m/todo', icon: ClipboardCheck, enabled: false },
    { id: 'supervision', label: '督办', path: '/m/supervision', icon: Eye, enabled: false },
    { id: 'messages', label: '消息', path: '/m/messages', icon: MessageCircle, enabled: false },
    { id: 'mine', label: '我的', path: '/m/mine', icon: User, enabled: false },
  ];

  const handleTabClick = (tab: typeof tabs[0]) => {
    if (tab.enabled) {
      navigate(tab.path);
    } else {
      setToastMessage(`「${tab.label}」模块移动端正在联调阶段，一期已优先就绪「免登与通讯录同步」核心功能。`);
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col max-w-md mx-auto relative shadow-xl border-x border-slate-100">
      {/* 头部导航栏 */}
      <header className="sticky top-0 z-50 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-bold text-slate-800">{title}</h1>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-[10px] text-white font-bold">
            {currentUser.name?.slice(-2) || '员工'}
          </div>
          <span className="text-xs text-slate-500 font-medium">{currentUser.name}</span>
        </div>
      </header>

      {/* 主体内容区 */}
      <main className="flex-1 pb-20 overflow-y-auto px-4 pt-4">
        {children}
      </main>

      {/* 功能联调阶段 Toast 浮层 */}
      {toastMessage && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-xs bg-slate-900/95 text-white p-3 rounded-xl text-xs flex items-start gap-2 shadow-lg animate-fade-in">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 底部 5 Tab 栏 */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t border-slate-100 py-2 px-1 flex items-center justify-around z-40 shadow-[0_-2px_10px_rgba(0,0,0,0.02)]">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = location.pathname === tab.path;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab)}
              className={`flex flex-col items-center gap-1 flex-1 py-1 transition-all active:scale-95 ${
                isActive 
                  ? 'text-blue-600 font-bold' 
                  : tab.enabled 
                    ? 'text-slate-500 hover:text-slate-700' 
                    : 'text-slate-300'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] tracking-wide">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default MobileLayout;
