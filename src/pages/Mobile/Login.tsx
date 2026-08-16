import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { api } from '../../lib/api';
import { Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import { mapRoleIdentityToUserRole } from '../../store/role-access';

const AUTH_TOKEN_KEY = 'duban-auth-token';

export const MobileLogin: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { setUserRole, syncRoles, syncItems } = useStore();

  useEffect(() => {
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
          user.username
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
  }, [setUserRole, syncRoles, syncItems]);

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
