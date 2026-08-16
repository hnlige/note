import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '../../components/Layout/MainLayout';
import { useStore } from '../../store/useStore';
import { useToast } from '../../components/Common/Toast';
import { 
  ChevronLeft, 
  Save, 
  Zap, 
  Bell, 
  Smartphone, 
  Mail, 
  Clock,
  Settings
} from 'lucide-react';
import type { GlobalRules } from '../../types';
import { getGlobalRulesNavigation } from './rules-navigation';

const DEFAULT_RULES: GlobalRules = {
  yellowLightDays: 3,
  redLightHours: 24,
  autoUrgeFrequency: 1,
  autoRemindEnabled: true,
  autoUrgeEnabled: false,
  urgeChannels: ['SYSTEM'],
  serialRule: { prefix: 'DB', showYear: true, sequenceLength: 3, connector: '-' },
  notifTemplates: { urge: '', warning: '', audit: '' },
  auditFlow: { enableMultiLevel: false, auditRoles: ['ADMIN'] },
};

const RulesConfig: React.FC = () => {
  const navigate = useNavigate();
  const { globalRules, updateGlobalRules, addLog, currentUser, roles } = useStore();
  const { showToast } = useToast();
  // 防御性：确保 globalRules 关键字段存在，防止后端同步空数据导致渲染崩溃
  const safeRules = React.useMemo(() => ({
    ...DEFAULT_RULES,
    ...globalRules,
    serialRule: { ...DEFAULT_RULES.serialRule, ...globalRules?.serialRule },
    notifTemplates: { ...DEFAULT_RULES.notifTemplates, ...globalRules?.notifTemplates },
    auditFlow: { ...DEFAULT_RULES.auditFlow, ...globalRules?.auditFlow },
  }), [globalRules]);
  const [localRules, setLocalRules] = React.useState(safeRules);
  const navigation = React.useMemo(
    () => getGlobalRulesNavigation(currentUser, roles),
    [currentUser, roles],
  );

  const handleSave = async () => {
    if (!currentUser?.id) return;

    try {
      await updateGlobalRules(localRules);
      addLog({
        userName: currentUser.name || '系统',
        userId: currentUser.id,
        action: '更新全局规则配置',
        module: '规则设置'
      });
      showToast('全局规则已成功应用', 'success');
      navigate(navigation.successPath);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : '应用全局规则失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  return (
    <MainLayout>
      <div className="mb-8">
        <button 
          onClick={() => navigate(navigation.backPath)}
          className="flex items-center gap-1 text-slate-500 hover:text-slate-900 font-semibold transition-colors mb-4"
        >
          <ChevronLeft className="w-4 h-4" />
          {navigation.backLabel}
        </button>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">全局规则配置</h1>
            <span className="bg-orange-50 text-orange-600 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">三级页面</span>
          </div>
          <button 
            onClick={handleSave}
            className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 transition-all shadow-md shadow-blue-100 active:scale-95"
          >
            <Save className="w-4 h-4" />
            应用全局规则
          </button>
        </div>
      </div>

      <div className="space-y-8 max-w-4xl">
        {/* Rule Section 1: Light Triggers */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-50 bg-slate-50/30 flex items-center gap-3">
            <div className="p-2 bg-orange-100 text-orange-600 rounded-lg">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">亮灯预警机制</h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">配置系统自动触发红/黄灯的阈值与逻辑。</p>
            </div>
          </div>
          
          <div className="p-8 space-y-10">
            <div className="flex items-start gap-12">
              <div className="w-1/3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <h4 className="text-sm font-bold text-slate-900">黄灯 (预警)</h4>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">当事项接近截止日期时触发，提醒承办人注意进度。</p>
              </div>
              <div className="flex-1 space-y-4">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-slate-600">距离截止日期</span>
                  <div className="relative w-24">
                    <input 
                      type="number" 
                      value={localRules.yellowLightDays} 
                      onChange={(e) => setLocalRules({ ...localRules, yellowLightDays: parseInt(e.target.value) })}
                      className="w-full bg-slate-50 border-none rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 font-bold" 
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">天</span>
                  </div>
                  <span className="text-sm font-medium text-slate-600">时自动亮起黄灯</span>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-12">
              <div className="w-1/3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <h4 className="text-sm font-bold text-slate-900">红灯 (告警)</h4>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">当事项超过截止日期仍未办结时触发，计入逾期考核。</p>
              </div>
              <div className="flex-1 space-y-4">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-slate-600">超过截止日期</span>
                  <div className="relative w-24">
                    <input 
                      type="number" 
                      value={localRules.redLightHours} 
                      onChange={(e) => setLocalRules({ ...localRules, redLightHours: parseInt(e.target.value) })}
                      className="w-full bg-slate-50 border-none rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500 font-bold" 
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">小时</span>
                  </div>
                  <span className="text-sm font-medium text-slate-600">后立即亮起红灯</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Rule Section 2: Urge Rules */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-50 bg-slate-50/30 flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">系统自动催办策略</h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">定义在亮灯状态下，系统执行自动催办的频率与渠道。</p>
            </div>
          </div>

          <div className="p-8 space-y-8">
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                催办频率
              </h4>
              <div className="grid grid-cols-1 gap-6">
                <div className="p-4 bg-slate-50 rounded-xl">
                  <p className="text-xs font-bold text-slate-400 uppercase mb-3">自动催办频率</p>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-600">每隔</span>
                    <input 
                      type="number" 
                      value={localRules.autoUrgeFrequency} 
                      onChange={(e) => setLocalRules({ ...localRules, autoUrgeFrequency: parseInt(e.target.value) })}
                      className="w-16 bg-white border border-slate-200 rounded-lg py-1 px-2 text-sm font-bold text-center" 
                    />
                    <span className="text-sm text-slate-600">天催办一次</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-4">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Settings className="w-4 h-4 text-slate-400" />
                推送渠道
              </h4>
              <div className="flex items-center gap-8">
                {[
                  { id: 'SYSTEM', label: '站内推送', icon: Bell },
                  { id: 'SMS', label: '短信通知', icon: Smartphone },
                  { id: 'EMAIL', label: '电子邮件', icon: Mail },
                ].map(channel => (
                  <div key={channel.id} className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                      <channel.icon className="w-4 h-4 text-blue-600" />
                    </div>
                    <span className="text-sm font-semibold text-slate-700">{channel.label}</span>
                    <input 
                      type="checkbox" 
                      checked={localRules.urgeChannels.includes(channel.id)} 
                      onChange={(e) => {
                        const newChannels = e.target.checked 
                          ? [...localRules.urgeChannels, channel.id]
                          : localRules.urgeChannels.filter(c => c !== channel.id);
                        setLocalRules({ ...localRules, urgeChannels: newChannels });
                      }}
                      className="rounded border-slate-300 text-blue-600" 
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default RulesConfig;
