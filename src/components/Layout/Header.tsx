import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Bell, User as UserIcon, ChevronDown, LogOut, Settings, UserCircle } from 'lucide-react';
import { useStore, getUnreadVisibleMessageCount, getDeptPath } from '../../store/useStore';
import { NotificationCenter } from './NotificationCenter';
import { motion, AnimatePresence } from 'framer-motion';
import { shouldHideHeaderSearch } from './header-search';
import { getSystemSettingsPath } from './header-settings';

export const Header: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, logout, messages, items, searchTerm, setSearchTerm, orgUsers, departments, roles } = useStore();
  const hideHeaderSearch = shouldHideHeaderSearch(location.pathname);

  // 查找当前用户的真实所属部门完整路径
  const currentDeptName = useMemo(() => {
    const orgUser = orgUsers.find(u => u.id === currentUser.id);
    const deptId = orgUser?.deptId || currentUser.deptId;
    if (!deptId) return '未分配部门';
    return getDeptPath(departments, deptId) || '未知部门';
  }, [orgUsers, departments, currentUser.id, currentUser.deptId]);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  useEffect(() => {
    if (hideHeaderSearch && searchTerm) {
      setSearchTerm('');
    }
  }, [hideHeaderSearch, searchTerm, setSearchTerm]);

  // 过滤当前用户可见的消息未读数
  const unreadCount = getUnreadVisibleMessageCount(messages, currentUser, items);

  return (
    <header className="h-16 bg-white border-b border-slate-200 fixed top-0 right-0 left-64 z-40 px-6 flex items-center justify-between">
      {hideHeaderSearch ? (
        <div className="flex-1" />
      ) : (
        <div className="flex items-center gap-4 flex-1 max-w-xl">
          <div className="relative w-full">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="搜索督办事项、字号、负责人..."
              className="w-full bg-slate-50 border-none rounded-lg py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') navigate('/items');
              }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-6">
        <div className="relative">
          <button 
            onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
            className="relative p-2 text-slate-500 hover:bg-slate-50 rounded-full transition-colors"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 border-2 border-white rounded-full"></span>
            )}
          </button>
          <NotificationCenter 
            isOpen={isNotificationsOpen} 
            onClose={() => setIsNotificationsOpen(false)} 
          />
        </div>

        <div className="relative">
          <div 
            className="flex items-center gap-3 pl-4 border-l border-slate-200 cursor-pointer group"
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
          >
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">{currentUser.name}</p>
              <p className="text-xs text-slate-500">{currentDeptName}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 ring-2 ring-transparent group-hover:ring-blue-100 transition-all">
              <UserIcon className="w-5 h-5" />
            </div>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
          </div>

          <AnimatePresence>
            {isUserMenuOpen && (
              <>
                <div className="fixed inset-0 z-50" onClick={() => setIsUserMenuOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 z-[60] py-1 overflow-hidden"
                >
                  <button 
                    onClick={() => { navigate('/profile'); setIsUserMenuOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <UserCircle className="w-4 h-4" />
                    个人中心
                  </button>
                  <button 
                    onClick={() => { navigate(getSystemSettingsPath(currentUser, roles)); setIsUserMenuOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    系统设置
                  </button>
                  <div className="h-px bg-slate-100 my-1" />
                  <button 
                    onClick={() => {
                      logout();
                      navigate('/login');
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors font-semibold"
                  >
                    <LogOut className="w-4 h-4" />
                    退出登录
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

    </header>
  );
};
