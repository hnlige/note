import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { api, AUTH_TOKEN_KEY, hasAuthToken } from '../../lib/api';
import { MobileLayout } from './Layout';
import { User, Building2, Shield, Bell, LogOut, ChevronRight, Loader2 } from 'lucide-react';

const ROLE_LABEL: Record<string, string> = {
  ADMIN: '管理员',
  OWNER: '责任人',
  FOLLOWER: '督办跟进人',
};

export const MobileMine: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, roles } = useStore();
  const [preferences, setPreferences] = useState<{ site?: boolean; email?: boolean; sms?: boolean } | null>(null);
  const [loadingPrefs, setLoadingPrefs] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (!hasAuthToken()) {
      window.location.replace('/m/login');
      return;
    }
    setLoadingPrefs(true);
    api.users.getPreferences()
      .then(setPreferences)
      .catch(() => setPreferences(null))
      .finally(() => setLoadingPrefs(false));
  }, []);

  const roleNames = (currentUser.roleIds || (currentUser.roleId ? [currentUser.roleId] : []))
    .map(rid => roles.find(r => r.id === rid)?.name)
    .filter(Boolean)
    .join('、') || ROLE_LABEL[currentUser.role] || '-';

  const handlePrefChange = async (key: 'site' | 'email' | 'sms', value: boolean) => {
    if (!preferences) return;
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    try {
      await api.users.updatePreferences({
        site: Boolean(next.site),
        email: Boolean(next.email),
        sms: Boolean(next.sms),
      });
    } catch {
      setPreferences(preferences);
    }
  };

  const handleLogout = () => {
    setLoggingOut(true);
    try {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    } catch {
      // storage 不可用时直接跳转即可
    }
    window.location.replace('/m/login');
  };

  const prefItems: { key: 'site' | 'email' | 'sms'; label: string }[] = [
    { key: 'site', label: '站内通知' },
    { key: 'email', label: '邮件通知' },
    { key: 'sms', label: '短信通知' },
  ];

  return (
    <MobileLayout title="我的">
      {/* 个人信息卡 */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-2xl p-5 mb-4 shadow-md">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center text-lg font-bold">
            {currentUser.name?.slice(0, 1) || '员'}
          </div>
          <div>
            <h2 className="text-lg font-bold">{currentUser.name}</h2>
            <p className="text-xs text-blue-100 mt-1">{currentUser.username || currentUser.id}</p>
          </div>
        </div>
        <div className="flex gap-4 mt-4 text-xs">
          <span className="flex items-center gap-1">
            <Building2 className="w-3.5 h-3.5" /> {currentUser.deptId || '未分配部门'}
          </span>
          <span className="flex items-center gap-1">
            <Shield className="w-3.5 h-3.5" /> {roleNames}
          </span>
        </div>
      </div>

      {/* 通知设置 */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Bell className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-700">消息通知设置</h3>
          {loadingPrefs && <Loader2 className="w-3.5 h-3.5 text-slate-300 animate-spin" />}
        </div>
        <div className="space-y-1">
          {prefItems.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-slate-600">{label}</span>
              {/* iOS 风格开关 */}
              <button
                onClick={() => handlePrefChange(key, !(preferences?.[key] ?? false))}
                disabled={!preferences}
                className={`w-11 h-6 rounded-full transition-all relative ${
                  preferences?.[key] ? 'bg-blue-600' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                    preferences?.[key] ? 'left-[22px]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 帮助 */}
      <button
        onClick={() => navigate('/m/home')}
        className="w-full bg-white rounded-2xl border border-slate-100 p-4 mb-4 flex items-center justify-between active:scale-[0.99] transition-all"
      >
        <div className="flex items-center gap-3">
          <User className="w-4 h-4 text-slate-400" />
          <span className="text-sm text-slate-700 font-medium">返回首页</span>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300" />
      </button>

      {/* 退出登录 */}
      <button
        onClick={handleLogout}
        disabled={loggingOut}
        className="w-full bg-white rounded-2xl border border-red-100 p-4 flex items-center justify-center gap-2 active:scale-[0.99] transition-all disabled:opacity-60"
      >
        {loggingOut ? (
          <Loader2 className="w-4 h-4 text-red-500 animate-spin" />
        ) : (
          <LogOut className="w-4 h-4 text-red-500" />
        )}
        <span className="text-sm text-red-500 font-bold">退出登录</span>
      </button>
    </MobileLayout>
  );
};

export default MobileMine;
