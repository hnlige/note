import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '../../components/Layout/MainLayout';
import { useStore, getDeptPath } from '../../store/useStore';
import { useToast } from '../../components/Common/Toast';
import { api } from '../../lib/api';
import { getProfileSystemSettingsState } from './profile-settings';
import { 
  User, 
  Mail, 
  Phone, 
  Building2, 
  ShieldCheck, 
  TrendingUp, 
  CheckCircle2, 
  Clock, 
  Settings,
  Bell,
  Lock,
  ChevronRight,
  X,
  Smartphone,
  Globe
} from 'lucide-react';
import { 
  Radar, 
  RadarChart, 
  PolarGrid, 
  PolarAngleAxis, 
  PolarRadiusAxis, 
  ResponsiveContainer 
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';

const Profile: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, items, orgUsers, departments, roles } = useStore();
  const systemSettingsState = getProfileSystemSettingsState(currentUser, roles);

  // 查找当前用户的组织用户信息和所属部门完整路径
  const currentOrgUser = React.useMemo(() => orgUsers.find(u => u.id === currentUser.id), [orgUsers, currentUser.id]);
  const currentDeptPath = React.useMemo(
    () => currentOrgUser?.deptId ? getDeptPath(departments, currentOrgUser.deptId) : '',
    [departments, currentOrgUser]
  );
  const { showToast } = useToast();
  const [isPrefOpen, setIsPrefOpen] = useState(false);
  const [isPwdOpen, setIsPwdOpen] = useState(false);
  const [pwdForm, setPwdForm] = useState({ oldPwd: '', newPwd: '', confirmPwd: '' });
  const [pwdError, setPwdError] = useState('');
  const [isPwdSubmitting, setIsPwdSubmitting] = useState(false);
  const [prefError, setPrefError] = useState('');
  const [isPrefSubmitting, setIsPrefSubmitting] = useState(false);
  const [prefs, setPrefs] = useState({
    site: true,
    email: true,
    sms: false
  });

  React.useEffect(() => {
    api.users.getPreferences()
      .then((remotePrefs) => setPrefs((current) => ({ ...current, ...remotePrefs })))
      .catch(() => {});
  }, []);

  // Dynamic Radar Data Calculation
  const userItems = items.filter(i => i.ownerId === currentUser.id || i.followerId === currentUser.id);
  const completedItems = userItems.filter(i => i.status === 'COMPLETED' || i.status === 'ARCHIVED');
  const delayedItems = userItems.filter(i => i.status === 'OVERDUE');

  const performanceMetrics = React.useMemo(() => {
    const total = userItems.length || 1;
    const completedCount = completedItems.length;
    
    // Response Timeliness: Based on average feedback frequency or last feedback date
    const responseScore = 85 + (completedCount * 2); 
    
    // Material Quality: Based on ratings from audit
    const qualityScore = completedItems.reduce((acc, curr) => acc + (curr.rating || 5), 0) / (completedCount || 1) * 20 + 20;
    
    // On-time Rate
    const onTimeRate = ((completedCount - delayedItems.length) / total) * 100;
    
    // Multitasking: Based on total items handled
    const multiTaskScore = Math.min(60 + (total * 5), 100);

    return [
      { subject: '响应及时性', A: Math.min(responseScore, 100), fullMark: 100 },
      { subject: '材料完整度', A: Math.min(qualityScore, 100), fullMark: 100 },
      { subject: '按期结案率', A: Math.max(Math.min(onTimeRate, 100), 40), fullMark: 100 },
      { subject: '沟通积极性', A: 90, fullMark: 100 },
      { subject: '多任务并行', A: multiTaskScore, fullMark: 100 },
    ];
  }, [userItems, completedItems, delayedItems]);

  const recentItems = userItems.slice(0, 3);
  const handleChangePassword = async () => {
    if (!pwdForm.oldPwd) { setPwdError('请输入当前密码'); return; }
    if (pwdForm.newPwd.length < 6) { setPwdError('新密码长度不能少于6位'); return; }
    if (pwdForm.newPwd !== pwdForm.confirmPwd) { setPwdError('两次输入的新密码不一致'); return; }

    setPwdError('');
    setIsPwdSubmitting(true);
    try {
      await api.auth.changePassword(pwdForm.oldPwd, pwdForm.newPwd);
      setIsPwdOpen(false);
      setPwdForm({ oldPwd: '', newPwd: '', confirmPwd: '' });
      showToast('密码修改成功，请使用新密码重新登录', 'success');
    } catch (error) {
      setPwdError(error instanceof Error ? error.message : '密码修改失败');
    } finally {
      setIsPwdSubmitting(false);
    }
  };
  const handleSavePrefs = async () => {
    setPrefError('');
    setIsPrefSubmitting(true);
    try {
      await api.users.updatePreferences(prefs);
      setIsPrefOpen(false);
      showToast('通知偏好已保存', 'success');
    } catch (error) {
      setPrefError(error instanceof Error ? error.message : '偏好保存失败');
    } finally {
      setIsPrefSubmitting(false);
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">个人中心</h1>
          <p className="text-slate-500 text-sm mt-1">查看个人督办效能画像及系统偏好设置。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Basic Info */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-r from-blue-600 to-indigo-600 opacity-10" />
            <div className="relative">
              <div className="w-24 h-24 rounded-full bg-blue-100 border-4 border-white shadow-md flex items-center justify-center text-blue-600 mx-auto mb-4">
                <User className="w-10 h-10" />
              </div>
              <h2 className="text-xl font-bold text-slate-900">{currentUser.name}</h2>
              <div className="flex items-center justify-center gap-1.5 mt-1 text-blue-600 bg-blue-50 px-3 py-1 rounded-full w-fit mx-auto">
                <ShieldCheck className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  {currentUser.role === 'ADMIN' ? '系统管理员' : '普通用户'}
                </span>
              </div>
            </div>

            <div className="mt-8 space-y-4 text-left">
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <Building2 className="w-4 h-4 text-slate-400" />
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">所属部门</p>
                  <p className="text-sm font-bold text-slate-700">{currentDeptPath || '未分配部门'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <Mail className="w-4 h-4 text-slate-400" />
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">工作邮箱</p>
                  <p className="text-sm font-bold text-slate-700">{currentOrgUser?.email || (currentUser.name.toLowerCase() + '@hospital.com')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <Phone className="w-4 h-4 text-slate-400" />
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">联系电话</p>
                  <p className="text-sm font-bold text-slate-700">{currentOrgUser?.phone || '未设置'}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-400" />
              个人偏好
            </h3>
            
            <button 
              onClick={() => { setPrefError(''); setIsPrefOpen(true); }}
              className="w-full flex items-center justify-between p-3 hover:bg-slate-50 rounded-xl transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Bell className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold text-slate-700">通知接收设置</p>
                  <p className="text-[10px] text-slate-400 font-medium">站内信、邮件提醒方式</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300" />
            </button>

            <button 
              onClick={() => { setIsPwdOpen(true); setPwdForm({ oldPwd: '', newPwd: '', confirmPwd: '' }); setPwdError(''); }}
              className="w-full flex items-center justify-between p-3 hover:bg-slate-50 rounded-xl transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Lock className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold text-slate-700">修改登录密码</p>
                  <p className="text-[10px] text-slate-400 font-medium">定期修改密码保障安全</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300" />
            </button>

            <button
              type="button"
              disabled={!systemSettingsState.enabled}
              onClick={() => {
                if (!systemSettingsState.enabled) return;
                navigate(systemSettingsState.path);
              }}
              className="w-full flex items-center justify-between p-3 hover:bg-slate-50 rounded-xl transition-all group disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Settings className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold text-slate-700">系统设置</p>
                  <p className="text-[10px] text-slate-400 font-medium">
                    {systemSettingsState.enabled ? '通用参数与规则配置' : '当前账号未配置系统设置访问权限'}
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300" />
            </button>
          </div>
        </div>

        {/* Right Column: Performance Radar */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-600" />
                督办效能画像
              </h3>
              <select className="bg-slate-50 border-none text-xs font-bold text-slate-600 rounded-lg py-1.5 px-3 focus:ring-0 cursor-pointer">
                <option>2026年上半年</option>
                <option>2025年下半年</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="80%" data={performanceMetrics}>
                    <PolarGrid stroke="#f1f5f9" />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12, fontWeight: 600, fill: '#64748b' }} />
                    <PolarRadiusAxis hide />
                    <Radar
                      name="能力得分"
                      dataKey="A"
                      stroke="#2563EB"
                      fill="#2563EB"
                      fillOpacity={0.15}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-6">
                <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-50">
                  <h4 className="text-sm font-bold text-blue-900 mb-2">效能诊断报告</h4>
                  <p className="text-xs text-blue-700 leading-relaxed">
                    {completedItems.length > 0 ? (
                      `根据最近 ${userItems.length} 项任务分析，您在事项完成度上表现稳定。建议保持当前的反馈频率。`
                    ) : (
                      "目前暂无足够的结案数据进行效能诊断，请在完成事项后查看实时画像。"
                    )}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-4 rounded-xl border border-slate-100">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      <span className="text-xs font-bold text-slate-400">累计结案</span>
                    </div>
                    <p className="text-xl font-bold text-slate-900">{completedItems.length} 项</p>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-100">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="w-4 h-4 text-orange-500" />
                      <span className="text-xs font-bold text-slate-400">平均得分</span>
                    </div>
                    <p className="text-xl font-bold text-slate-900">
                      {(completedItems.reduce((acc, curr) => acc + (curr.rating || 5), 0) / (completedItems.length || 1)).toFixed(1)} 分
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-50">
              <h3 className="text-lg font-bold text-slate-900">最近负责的事项</h3>
            </div>
            <div className="p-6">
              {recentItems.length > 0 ? (
                <div className="space-y-4">
                  {recentItems.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl group hover:bg-white hover:shadow-md transition-all border border-transparent hover:border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${
                          item.status === 'COMPLETED' ? 'bg-green-500' : 'bg-blue-500'
                        }`} />
                        <div>
                          <p className="text-sm font-bold text-slate-700">{item.title}</p>
                          <p className="text-[10px] text-slate-400">{item.serialNo}</p>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-all" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-slate-300">
                  <CheckCircle2 className="w-12 h-12 mb-3 opacity-20" />
                  <p className="text-sm font-bold">暂无负责中的督办事项</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isPwdOpen && (
          <div className="fixed inset-0 flex items-center justify-center z-[110] p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsPwdOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600">
                    <Lock className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-slate-900">修改登录密码</h3>
                </div>
                <button onClick={() => setIsPwdOpen(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-8 space-y-5">
                {pwdError && (
                  <div className="p-3 bg-red-50 text-red-700 text-sm font-medium rounded-xl border border-red-100">
                    {pwdError}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">当前密码</label>
                  <input 
                    type="password"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                    placeholder="请输入当前密码"
                    value={pwdForm.oldPwd}
                    onChange={(e) => setPwdForm({ ...pwdForm, oldPwd: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">新密码</label>
                  <input 
                    type="password"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                    placeholder="请输入新密码（至少6位）"
                    value={pwdForm.newPwd}
                    onChange={(e) => setPwdForm({ ...pwdForm, newPwd: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">确认新密码</label>
                  <input 
                    type="password"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                    placeholder="请再次输入新密码"
                    value={pwdForm.confirmPwd}
                    onChange={(e) => setPwdForm({ ...pwdForm, confirmPwd: e.target.value })}
                  />
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                <button 
                  onClick={() => setIsPwdOpen(false)}
                  className="px-6 py-2 text-slate-500 font-bold text-sm hover:bg-white rounded-xl transition-all"
                >
                  取消
                </button>
                <button 
                  onClick={handleChangePassword}
                  disabled={isPwdSubmitting}
                  className="px-6 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPwdSubmitting ? '提交中...' : '确认修改'}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {isPrefOpen && (
          <div className="fixed inset-0 flex items-center justify-center z-[100] p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsPrefOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                    <Bell className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-slate-900">通知接收设置</h3>
                </div>
                <button onClick={() => setIsPrefOpen(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-8 space-y-6">
                {prefError && (
                  <div className="p-3 bg-red-50 text-red-700 text-sm font-medium rounded-xl border border-red-100">
                    {prefError}
                  </div>
                )}
                {[
                  { id: 'site', label: '站内消息', icon: Globe, desc: '在系统顶部通知栏实时提醒' },
                  { id: 'email', label: '邮件提醒', icon: Mail, desc: '重要事项、超期预警发送至工作邮箱' },
                  { id: 'sms', label: '短信通知', icon: Smartphone, desc: '紧急催办指令将通过手机短信下发' },
                ].map((item) => (
                  <label key={item.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 cursor-pointer hover:border-blue-200 transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-400">
                        <item.icon className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-700">{item.label}</p>
                        <p className="text-[10px] text-slate-400 font-medium">{item.desc}</p>
                      </div>
                    </div>
                    <div 
                      onClick={() => setPrefs({ ...prefs, [item.id]: !prefs[item.id as keyof typeof prefs] })}
                      className={`w-10 h-5 rounded-full transition-colors relative ${prefs[item.id as keyof typeof prefs] ? 'bg-blue-600' : 'bg-slate-300'}`}
                    >
                      <motion.div 
                        animate={{ x: prefs[item.id as keyof typeof prefs] ? 20 : 2 }}
                        className="absolute top-1 w-3 h-3 bg-white rounded-full shadow-sm"
                      />
                    </div>
                  </label>
                ))}
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                <button 
                  onClick={() => setIsPrefOpen(false)}
                  className="px-6 py-2 text-slate-500 font-bold text-sm hover:bg-white rounded-xl transition-all"
                >
                  取消
                </button>
                <button 
                  onClick={handleSavePrefs}
                  disabled={isPrefSubmitting}
                  className="px-6 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPrefSubmitting ? '保存中...' : '保存设置'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </MainLayout>
  );
};

export default Profile;
