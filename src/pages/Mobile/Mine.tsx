import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { api, AUTH_TOKEN_KEY, hasAuthToken } from '../../lib/api';
import { useToast } from '../../components/Common/Toast';
import { MobileLayout } from './Layout';
import { ModalShell, FieldLabel } from './components/ModalShell';
import { User, Building2, Shield, Bell, KeyRound, LogOut, ChevronRight, Loader2 } from 'lucide-react';

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
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdForm, setPwdForm] = useState({ oldPwd: '', newPwd: '', confirmPwd: '' });
  const [pwdError, setPwdError] = useState('');
  const [pwdSubmitting, setPwdSubmitting] = useState(false);
  const { showToast } = useToast();

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

  const openPwdModal = () => {
    setPwdForm({ oldPwd: '', newPwd: '', confirmPwd: '' });
    setPwdError('');
    setPwdOpen(true);
  };

  const handleChangePassword = async () => {
    if (!pwdForm.oldPwd) { setPwdError('请输入当前密码'); return; }
    if (pwdForm.newPwd.length < 6) { setPwdError('新密码长度不能少于6位'); return; }
    if (pwdForm.newPwd.length > 72) { setPwdError('新密码不能超过72个字符'); return; }
    if (pwdForm.newPwd === pwdForm.oldPwd) { setPwdError('新密码不能与当前密码相同'); return; }
    if (pwdForm.newPwd !== pwdForm.confirmPwd) { setPwdError('两次输入的新密码不一致'); return; }

    setPwdError('');
    setPwdSubmitting(true);
    try {
      await api.auth.changePassword(pwdForm.oldPwd, pwdForm.newPwd);
      setPwdOpen(false);
      setPwdForm({ oldPwd: '', newPwd: '', confirmPwd: '' });
      showToast('密码修改成功，请使用新密码重新登录', 'success');
    } catch (error) {
      setPwdError(error instanceof Error ? error.message : '密码修改失败');
    } finally {
      setPwdSubmitting(false);
    }
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

      {/* 账号设置 */}
      <button
        onClick={openPwdModal}
        className="w-full bg-white rounded-2xl border border-slate-100 p-4 mb-4 flex items-center justify-between active:scale-[0.99] transition-all"
      >
        <div className="flex items-center gap-3">
          <KeyRound className="w-4 h-4 text-slate-400" />
          <span className="text-sm text-slate-700 font-medium">修改密码</span>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300" />
      </button>

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

      {/* 修改密码弹窗 */}
      <ModalShell
        title="修改密码"
        open={pwdOpen}
        onClose={() => setPwdOpen(false)}
        onSubmit={handleChangePassword}
        submitLabel="确认修改"
        submitDisabled={!pwdForm.oldPwd || !pwdForm.newPwd || !pwdForm.confirmPwd}
        submitting={pwdSubmitting}
        hasContent={Boolean(pwdForm.oldPwd || pwdForm.newPwd || pwdForm.confirmPwd)}
      >
        <div className="space-y-4">
          <div>
            <FieldLabel required>当前密码</FieldLabel>
            <input
              type="password"
              value={pwdForm.oldPwd}
              onChange={(e) => setPwdForm(f => ({ ...f, oldPwd: e.target.value }))}
              placeholder="请输入当前密码"
              autoComplete="current-password"
              className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
            />
          </div>
          <div>
            <FieldLabel required hint="至少6位">
              新密码
            </FieldLabel>
            <input
              type="password"
              value={pwdForm.newPwd}
              onChange={(e) => setPwdForm(f => ({ ...f, newPwd: e.target.value }))}
              placeholder="请输入新密码（至少6位）"
              autoComplete="new-password"
              className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
            />
          </div>
          <div>
            <FieldLabel required>确认新密码</FieldLabel>
            <input
              type="password"
              value={pwdForm.confirmPwd}
              onChange={(e) => setPwdForm(f => ({ ...f, confirmPwd: e.target.value }))}
              placeholder="请再次输入新密码"
              autoComplete="new-password"
              className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
            />
          </div>
          {pwdError && (
            <p className="text-xs text-red-500 font-bold bg-red-50 rounded-lg px-3 py-2">{pwdError}</p>
          )}
        </div>
      </ModalShell>
    </MobileLayout>
  );
};

export default MobileMine;
