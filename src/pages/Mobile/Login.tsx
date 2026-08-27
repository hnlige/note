import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { api } from '../../lib/api';
import { Loader2, AlertCircle, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { mapRoleIdentityToUserRole } from '../../store/role-access';
import { UserRole } from '../../types';

const AUTH_TOKEN_KEY = 'duban-auth-token';

// 企业微信客户端 UA 才走免登；开发者工具/普通浏览器走账号密码降级登录
const isWecomEnv = (): boolean =>
  typeof navigator !== 'undefined' && /wxwork/i.test(navigator.userAgent);

export const MobileLogin: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const { setUserRole, syncRoles, syncItems, syncOrgUsers, syncDepartments } = useStore();

  // 账号密码降级登录（非企业微信环境：开发者工具 / 普通浏览器）
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await api.auth.login(account.trim(), password.trim());
      localStorage.setItem(AUTH_TOKEN_KEY, user.token);
      const mappedRole: UserRole = mapRoleIdentityToUserRole(user);
      setUserRole(
        mappedRole,
        user.id,
        user.name,
        user.roleId,
        user.roleIds,
        user.deptId,
        user.orgId,
        user.adminOrgIds,
        user.username,
      );
      await syncRoles();
      await Promise.all([syncOrgUsers(), syncDepartments()]).catch(() => {});
      await syncItems().catch(() => {});
      window.location.replace('/m/home');
    } catch (err: any) {
      const status = err?.status;
      setError(
        typeof status === 'number' && status < 500
          ? err?.message || '账号或密码错误'
          : '后端服务不可用，请稍后重试',
      );
      setLoading(false);
    }
  };

  useEffect(() => {
    // 非企业微信环境：不发起企业微信 OAuth，直接展示账号密码登录表单
    if (!isWecomEnv()) {
      setLoading(false);
      return;
    }

    const handleWecomOauth = async () => {
      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get('code');

      if (!code) {
        // 1. 无 code 时，先向后端拉取 CorpID 与 AgentID
        try {
          const config = await api.wecom.getConfig();
          if (!config.wecomCorpId) {
            setError('企业微信集成功能暂未开启或管理员未配置 CorpID，请联系管理员配置。');
            setLoading(false);
            return;
          }

          // 2. 发起企业微信内置重定向授权
          const redirectUri = encodeURIComponent(window.location.origin + '/m/login');
          const oauthUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(config.wecomCorpId)}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_base&agentid=${encodeURIComponent(config.wecomAgentId)}&state=wecom#wechat_redirect`;

          window.location.replace(oauthUrl);
        } catch (err: any) {
          console.error('Fetch wecom config error:', err);
          setError('拉取免登配置失败，请确保后端服务正常运行。');
          setLoading(false);
        }
        return;
      }

      // 3. 有 code 时，调用后端完成免登及身份匹配
      try {
        const user = await api.wecom.login(code);

        // 写入登录态与 Store 状态
        localStorage.setItem(AUTH_TOKEN_KEY, user.token);
        const mappedRole = mapRoleIdentityToUserRole(user);
        setUserRole(
          mappedRole,
          user.id,
          user.name,
          user.roleId,
          user.roleIds,
          user.deptId,
          user.orgId,
          user.adminOrgIds,
          user.username,
        );

        // 同步底层数据定义
        await syncRoles();
        await syncItems().catch(() => {});

        // 免登成功，跳转到移动端首页
        window.location.replace('/m/home');
      } catch (err: any) {
        console.error('Wecom auth failed:', err);
        setError(err.message || '企业微信免登鉴权失败，请确认您的账号是否已同步建档。');
        setLoading(false);
      }
    };

    handleWecomOauth();
  }, [setUserRole, syncRoles, syncItems, syncOrgUsers, syncDepartments]);

  // 非企业微信环境：渲染账号密码登录表单
  if (!isWecomEnv()) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-full max-w-sm">
          <div className="w-16 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-100">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>

          <h1 className="text-xl font-bold text-slate-800 mb-2">移动端登录</h1>
          <p className="text-sm text-slate-400 mb-8">督办事项管理系统移动版</p>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <form onSubmit={handlePasswordLogin} className="space-y-4 text-left">
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700 font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">账号</label>
                <input
                  type="text"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="请输入账号"
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">密码</label>
                <div className="relative">
                  <input
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
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
                disabled={loading || !account.trim() || !password.trim()}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-sm shadow-blue-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? '登录中...' : '登录'}
              </button>
            </form>
          </div>

          <p className="text-xs text-slate-400 mt-8">
            一龄医学技术集团有限公司 © 2026
          </p>
        </div>
      </div>
    );
  }

  // 企业微信环境：原免登流程
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-full max-w-sm">
        <div className="w-16 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-100">
          <ShieldCheck className="w-8 h-8 text-white animate-pulse" />
        </div>

        <h1 className="text-xl font-bold text-slate-800 mb-2">企业微信免登</h1>
        <p className="text-sm text-slate-400 mb-8">督办事项管理系统移动版</p>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 min-h-[160px] flex flex-col items-center justify-center">
          {loading && (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              <span className="text-sm text-slate-500 font-medium">企业微信安全鉴权中...</span>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center gap-4">
              <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center text-red-500">
                <AlertCircle className="w-6 h-6" />
              </div>
              <p className="text-sm text-red-600 font-medium px-2 leading-relaxed">{error}</p>

              <button
                onClick={() => window.location.replace('/login')}
                className="mt-2 text-xs font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-4 py-2.5 rounded-xl transition-all"
              >
                降级 PC 账号密码登录
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-400 mt-8">
          一龄医学技术集团有限公司 © 2026
        </p>
      </div>
    </div>
  );
};

export default MobileLogin;
