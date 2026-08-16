import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  ClipboardList, 
  Settings, 
  Bell, 
  BarChart3, 
  FileText,
  Users,
  MessageSquare,
  Shield,
  History,
  CheckSquare,
  Trash2,
  Zap,
  Activity,
  UserCheck,
  ArrowRightLeft,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useStore } from '../../store/useStore';
import { canAccessByAuthCodes, getRoleByRoleId } from '../../store/role-access';
import { canAccessMyItems } from '../../store/navigation-access';

interface SidebarItem {
  icon: React.ElementType;
  label: string;
  path: string;
  roles: string[];
  authCode: string;
}

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const { currentUser, roles } = useStore();

  const isActive = (path: string) => {
    if (path === '/settings/role-permissions') {
      return ['/settings/role-permissions', '/settings/roles'].includes(location.pathname);
    }
    return location.pathname === path;
  };

  const currentRole = getRoleByRoleId(currentUser.roleId, roles);
  const hasAuth = (code: string) => canAccessByAuthCodes(currentUser, roles, [code]);

  const menuGroups: { title: string; roles: string[]; items: SidebarItem[] }[] = [
    {
      title: '工作台',
      roles: ['ADMIN', 'OWNER', 'FOLLOWER'],
      items: [
        { icon: LayoutDashboard, label: '工作台首页', path: '/workbench', roles: ['ADMIN', 'OWNER', 'FOLLOWER'], authCode: 'MENU_WORKBENCH' },
      ]
    },
    {
      title: '督办事项',
      roles: ['ADMIN', 'OWNER', 'FOLLOWER'],
      items: [
        { icon: UserCheck, label: '我的督办', path: '/my-items', roles: ['ADMIN', 'OWNER', 'FOLLOWER'], authCode: 'MENU_MY_ITEMS' },
        { icon: ClipboardList, label: '事项列表', path: '/items', roles: ['ADMIN', 'OWNER', 'FOLLOWER'], authCode: 'MENU_ITEMS' },
        { icon: CheckSquare, label: '办结审核', path: '/items/audit', roles: ['ADMIN'], authCode: 'MENU_AUDIT' },
        { icon: Trash2, label: '回收站', path: '/items/recycle-bin', roles: ['ADMIN', 'OWNER', 'FOLLOWER'], authCode: 'MENU_RECYCLE_BIN' },
        { icon: BarChart3, label: '统一台账', path: '/statistics', roles: ['ADMIN', 'FOLLOWER'], authCode: 'MENU_STATISTICS' },
      ]
    },
    {
      title: '跟踪催办',
      roles: ['ADMIN', 'FOLLOWER'],
      items: [
        { icon: Bell, label: '催办管理', path: '/monitoring', roles: ['ADMIN', 'FOLLOWER'], authCode: 'MENU_MONITORING' },
        { icon: Zap, label: '亮灯管理', path: '/monitoring/lights', roles: ['ADMIN'], authCode: 'MENU_LIGHTS' },
        { icon: MessageSquare, label: '消息列表', path: '/messages', roles: ['ADMIN', 'OWNER', 'FOLLOWER'], authCode: 'MENU_MESSAGES' },
      ]
    },
    {
      title: '系统管理',
      roles: ['ADMIN'],
      items: [
        { icon: Users, label: '组织与账号', path: '/settings/org', roles: ['ADMIN'], authCode: 'MENU_ORG' },
        { icon: Shield, label: '角色与数据权限', path: '/settings/role-permissions', roles: ['ADMIN'], authCode: 'MENU_ROLES' },
        { icon: Bell, label: '提醒策略', path: '/templates/rules', roles: ['ADMIN'], authCode: 'MENU_RULES' },
        { icon: Settings, label: '企业微信配置', path: '/settings/wecom', roles: ['ADMIN'], authCode: 'MENU_WECOM' },
        { icon: History, label: '操作日志', path: '/settings/logs', roles: ['ADMIN'], authCode: 'MENU_LOGS' },
        { icon: Activity, label: '任务监控', path: '/system/tasks', roles: ['ADMIN'], authCode: 'MENU_TASKS' },
        { icon: ArrowRightLeft, label: '督办转交', path: '/admin/reassign', roles: ['ADMIN'], authCode: 'MENU_SYSTEM' },
      ]
    }
  ];

  return (
    <aside className="w-64 bg-slate-900 text-white h-screen flex flex-col fixed left-0 top-0 z-50">
      <div className="p-5 flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
          <ClipboardList className="w-5 h-5 text-white" />
        </div>
        <span className="font-bold text-lg tracking-tight">督办管理系统</span>
      </div>
      
      <nav className="flex-1 px-3 py-3 space-y-5 overflow-y-auto scrollbar-sidebar">
        {menuGroups.map((group) => {
          const filteredItems = group.items.filter(item => {
            if (!hasAuth(item.authCode)) return false;
            if (item.path === '/my-items') return canAccessMyItems(currentUser, roles);
            return true;
          });
          if (filteredItems.length === 0) return null;

          return (
            <div key={group.title}>
              <h3 className="px-3 mb-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                {group.title}
              </h3>
              <div className="space-y-1">
                {filteredItems.map((item) => {
                  const active = isActive(item.path);
                  return (
                    <Link
                      key={item.label}
                      to={item.path}
                      data-testid={`nav-${item.label}`}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all",
                        active 
                          ? "bg-blue-600 text-white shadow-lg shadow-blue-900/50" 
                          : "text-slate-400 hover:bg-slate-800 hover:text-white"
                      )}
                    >
                      <item.icon className="w-5 h-5 shrink-0" />
                      <span>{item.label}</span>
                      {active && (
                        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-white text-xs font-bold">
            {currentUser.name?.charAt(0) || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{currentUser.name}</p>
            <p className="text-xs text-slate-500 truncate">{currentRole?.name || '角色配置异常'}</p>
          </div>
        </div>
      </div>
    </aside>
  );
};
