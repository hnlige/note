import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { hasAuthToken } from '../../lib/api';
import { MobileLayout } from './Layout';
import { 
  ClipboardList, 
  Clock, 
  Sparkles, 
  ChevronRight,
  ShieldCheck,
  Zap,
  Flame
} from 'lucide-react';

export const MobileHome: React.FC = () => {
  const navigate = useNavigate();
  const { items, currentUser, syncItems } = useStore();

  useEffect(() => {
    // 1. 免登鉴权校验
    if (!hasAuthToken()) {
      window.location.replace('/m/login');
      return;
    }
    
    // 2. 刷新最新督办事项数据
    syncItems().catch((err) => console.error('Sync items error:', err));
  }, [syncItems]);

  // 3. 统计指标计算 (待办数、超期数、跟进数)
  const stats = useMemo(() => {
    const now = new Date();
    let todoCount = 0;
    let overdueCount = 0;
    let followingCount = 0;

    for (const item of items) {
      const isOwner = item.ownerId === currentUser.id || item.ownerIds?.includes(currentUser.id);
      const isFollower = item.followerId === currentUser.id || item.followerIds?.includes(currentUser.id);

      // 待办数：待签收或执行中，且用户为责任人
      if (isOwner && (item.status === 'PENDING' || item.status === 'EXECUTING' || item.status === 'DELAYED')) {
        todoCount++;
      }

      // 超期数：截止时间小于现在，且非已完成
      if (item.deadline && new Date(item.deadline) < now && item.status !== 'COMPLETED' && item.status !== 'ARCHIVED') {
        overdueCount++;
      }

      // 跟进数：当前用户是跟进人
      if (isFollower) {
        followingCount++;
      }
    }

    return { todoCount, overdueCount, followingCount };
  }, [items, currentUser]);

  // 4. 今日/即将到期督办 (限制最多 5 条)
  const todayTodos = useMemo(() => {
    const now = new Date();
    return items
      .filter(item => {
        const isOwner = item.ownerId === currentUser.id || item.ownerIds?.includes(currentUser.id);
        const isActive = item.status === 'PENDING' || item.status === 'EXECUTING' || item.status === 'DELAYED';
        return isOwner && isActive;
      })
      .map(item => {
        const remainingDays = item.deadline 
          ? Math.ceil((new Date(item.deadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          : 999;
        return { ...item, remainingDays };
      })
      .sort((a, b) => a.remainingDays - b.remainingDays)
      .slice(0, 5);
  }, [items, currentUser]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <span className="px-2 py-0.5 text-[10px] font-bold text-amber-600 bg-amber-50 rounded-md">待签收</span>;
      case 'EXECUTING':
        return <span className="px-2 py-0.5 text-[10px] font-bold text-blue-600 bg-blue-50 rounded-md">执行中</span>;
      case 'DELAYED':
        return <span className="px-2 py-0.5 text-[10px] font-bold text-red-600 bg-red-50 rounded-md">已超期</span>;
      default:
        return <span className="px-2 py-0.5 text-[10px] font-bold text-slate-500 bg-slate-50 rounded-md">{status}</span>;
    }
  };

  return (
    <MobileLayout title="督办门户">
      {/* 欢迎模块 */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-2xl p-5 mb-5 shadow-md relative overflow-hidden">
        <div className="absolute right-[-10px] bottom-[-10px] opacity-10">
          <Sparkles className="w-32 h-32" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-amber-300 fill-amber-300 animate-bounce" />
            <span className="text-xs text-blue-100 font-bold tracking-wider uppercase">MOBILE PORTAL</span>
          </div>
          <h2 className="text-lg font-bold">您好，{currentUser.name}</h2>
          <p className="text-xs text-blue-100 mt-1">今天有 {stats.todoCount} 个督办待办，请按时完成签收与反馈。</p>
        </div>
      </div>

      {/* 数据看板 */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center text-center">
          <span className="text-2xl font-black text-blue-600">{stats.todoCount}</span>
          <span className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-wider">我的待办</span>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center text-center">
          <span className="text-2xl font-black text-red-500">{stats.overdueCount}</span>
          <span className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-wider">超期预警</span>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center text-center">
          <span className="text-2xl font-black text-emerald-600">{stats.followingCount}</span>
          <span className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-wider">跟进事项</span>
        </div>
      </div>

      {/* 快捷菜单 */}
      <div className="mb-6">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">一期核心服务</h3>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center text-green-600">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-800">企业微信通讯录已关联</h4>
              <p className="text-[10px] text-slate-400 mt-0.5">免登访问与本地账号已完成映射</p>
            </div>
          </div>
          <span className="text-[10px] text-green-600 bg-green-50 font-bold px-2 py-1 rounded-lg">运行中</span>
        </div>
      </div>

      {/* 高频待办事项列表 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">高频待办事项</h3>
          <span className="text-[10px] text-blue-600 font-bold flex items-center gap-0.5">查看全部 <ChevronRight className="w-3 h-3" /></span>
        </div>

        {todayTodos.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center flex flex-col items-center justify-center shadow-sm">
            <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 mb-3">
              <ClipboardList className="w-6 h-6" />
            </div>
            <p className="text-sm text-slate-400 font-medium">暂无督办待办，安心度过今天</p>
          </div>
        ) : (
          <div className="space-y-3">
            {todayTodos.map(todo => (
              <div 
                key={todo.id} 
                className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm relative overflow-hidden active:scale-[0.99] transition-all"
              >
                {/* 状态色条 */}
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                  todo.status === 'DELAYED' || todo.remainingDays < 0
                    ? 'bg-red-500' 
                    : todo.status === 'PENDING' 
                      ? 'bg-amber-500' 
                      : 'bg-blue-500'
                }`} />

                <div className="flex items-start justify-between gap-4 pl-1">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">#{todo.serialNo}</span>
                      {getStatusBadge(todo.status)}
                    </div>
                    <h4 className="text-sm font-bold text-slate-800 truncate">{todo.title}</h4>
                    
                    <div className="flex items-center gap-3 mt-3 text-[10px] text-slate-400 font-medium">
                      <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> 截止: {todo.deadline?.split(' ')[0] || '未设'}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end shrink-0">
                    {todo.remainingDays < 0 ? (
                      <div className="flex items-center gap-1 text-red-600 font-bold text-xs bg-red-50 px-2.5 py-1 rounded-xl">
                        <Flame className="w-3.5 h-3.5 fill-red-500 animate-pulse" />
                        <span>超期 {Math.abs(todo.remainingDays)} 天</span>
                      </div>
                    ) : todo.remainingDays === 0 ? (
                      <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">今天到期</span>
                    ) : (
                      <span className="text-xs font-bold text-slate-500 bg-slate-50 px-2 py-1 rounded-lg">剩 {todo.remainingDays} 天</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </MobileLayout>
  );
};

export default MobileHome;
