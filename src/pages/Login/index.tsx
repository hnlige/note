import React, { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { api } from '../../lib/api';
import { ClipboardList, EyeOff, Eye, AlertCircle, Loader2 } from 'lucide-react';
import { UserRole } from '../../types';
import { shouldSyncOrgUsers } from '../../store/bootstrap-sync';
import { canAccessByAuthCodes, mapRoleIdentityToUserRole } from '../../store/role-access';
import { canAccessMyItems } from '../../store/navigation-access';

const AUTH_TOKEN_KEY = 'duban-auth-token';

const LANDING_ROUTES = [
  { path: '/workbench', authCodes: ['MENU_WORKBENCH'] },
  { path: '/my-items', authCodes: ['MENU_MY_ITEMS'], extraCheck: canAccessMyItems },
  { path: '/items', authCodes: ['MENU_ITEMS'] },
  { path: '/items/audit', authCodes: ['MENU_AUDIT'] },
  { path: '/items/archives', authCodes: ['MENU_ARCHIVES'] },
  { path: '/items/recycle-bin', authCodes: ['MENU_RECYCLE_BIN'] },
  { path: '/monitoring', authCodes: ['MENU_MONITORING'] },
  { path: '/monitoring/lights', authCodes: ['MENU_LIGHTS'] },
  { path: '/statistics', authCodes: ['MENU_STATISTICS'] },
  { path: '/messages', authCodes: ['MENU_MESSAGES'] },
  { path: '/settings/org', authCodes: ['MENU_ORG'] },
  { path: '/settings/role-permissions', authCodes: ['MENU_ROLES'] },
];

const getLandingPath = (user: { roleId?: string; roleIds?: string[] }, roles: ReturnType<typeof useStore.getState>['roles']) =>
  LANDING_ROUTES.find(route =>
    canAccessByAuthCodes(user, roles, route.authCodes) &&
    (!route.extraCheck || route.extraCheck(user, roles))
  )?.path || '';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tokenExpired = searchParams.get('expired') === '1';
  const { setUserRole, syncOrgUsers, syncRoles, syncItems } = useStore();
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const accountRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const account = accountRef.current?.value.trim() || '';
    const password = passwordRef.current?.value.trim() || '';

    try {
      // 优先使用后端 API 登录
      const user = await api.auth.login(account, password);
      localStorage.setItem(AUTH_TOKEN_KEY, user.token);
      const mappedRole: UserRole = mapRoleIdentityToUserRole(user);
      setUserRole(mappedRole, user.id, user.name, user.roleId, user.roleIds, user.deptId, user.orgId, user.adminOrgIds, user.username);

      // 先同步角色定义，再根据后台实际权限跳转到第一个可访问页面，避免权限变更后固定跳转 /workbench 造成空白/无响应。
      await syncRoles();
      const latestRoles = useStore.getState().roles;
      const landingPath = getLandingPath({ roleId: user.roleId, roleIds: user.roleIds }, latestRoles);
      if (!landingPath) {
        setError('当前账号未分配任何可访问页面权限，请联系管理员配置角色权限');
        setLoading(false);
        return;
      }

      const syncTasks: Promise<unknown>[] = [syncItems()];
      if (shouldSyncOrgUsers({ roleId: user.roleId, roleIds: user.roleIds }, latestRoles)) {
        syncTasks.push(syncOrgUsers());
      }
      await Promise.allSettled(syncTasks);
      navigate(landingPath);
      setLoading(false);
      return;
    } catch (apiError) {
      const apiErr = apiError as { status?: number; message?: string } | undefined;
      // 4xx 为真正的业务错误（如账号密码错误），显示错误信息
      // 5xx/无 status 为后端不可用（Vite 代理返回 500/502/503）
      if (typeof apiErr?.status === 'number' && apiErr.status < 500) {
        setError(apiErr.message || '登录失败');
        setLoading(false);
        return;
      }
      setError('后端服务不可用，请稍后重试或联系管理员');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-200">
            <ClipboardList className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">督办事项管理系统</h1>
          <p className="text-slate-500 text-sm mt-1">一龄医学技术集团有限公司 · 内部统一登录</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
          <form onSubmit={handleLogin} className="space-y-6">
            {tokenExpired && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-700 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                登录已过期，请重新登录以继续使用
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">账号</label>
              <input
                ref={accountRef}
                type="text"
                placeholder="请输入账号"
                className="w-full bg-slate-50 border border-slate-100 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">密码</label>
              <div className="relative">
                <input
                  ref={passwordRef}
                  type={showPwd ? 'text' : 'password'}
                  placeholder="请输入密码"
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl py-3 px-4 pr-12 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPwd ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-sm shadow-blue-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? '登录中...' : '登录'}
            </button>
          </form>

        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          督办管理系统V1.0 · 一龄医学技术集团有限公司 © 2026
        </p>
      </div>
    </div>
  );
};

export default Login;
