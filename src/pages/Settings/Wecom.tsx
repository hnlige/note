import React, { useEffect, useState } from 'react';
import { MainLayout } from '../../components/Layout/MainLayout';
import { useStore } from '../../store/useStore';
import { useToast } from '../../components/Common/Toast';
import { api } from '../../lib/api';
import { 
  Wrench, 
  CheckCircle2, 
  AlertCircle, 
  Save,
  TestTube,
  Eye,
  EyeOff
} from 'lucide-react';
import { motion } from 'framer-motion';

const SECRET_MASK = '••••••••••••••••••••••••';

const WecomSettings: React.FC = () => {
  const { addLog, currentUser } = useStore();
  const { showToast } = useToast();
  const [config, setConfig] = useState({
    corpid: 'ww1234567890abcdef',
    agentId: '1000001',
    secret: '',
    token: 'abc123token',
    encodingAesKey: '',
    callbackUrl: 'https://duban.example.com/api/wecom/callback',
    notifTemplateUrge: '您有新的督办催办：【{事项标题}】，请及时处理。',
    notifTemplateWarning: '督办事项【{事项标题}】已超期，请尽快提交延期申请。',
    notifTemplateDone: '督办事项【{事项标题}】已完成归档。',
  });
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    let active = true;
    api.globalRules.get()
      .then((rules) => {
        if (!active) return;
        setConfig((current) => ({
          ...current,
          corpid: rules.wecomCorpId || current.corpid,
          agentId: rules.wecomAgentId || current.agentId,
          secret: rules.wecomCorpSecret || '',
          token: rules.wecomToken || current.token,
          encodingAesKey: rules.wecomEncodingAesKey || current.encodingAesKey,
          callbackUrl: rules.wecomCallbackUrl || current.callbackUrl,
          notifTemplateUrge: rules.wecomTemplates?.urge || current.notifTemplateUrge,
          notifTemplateWarning: rules.wecomTemplates?.warning || current.notifTemplateWarning,
          notifTemplateDone: rules.wecomTemplates?.done || current.notifTemplateDone,
        }));
      })
      .catch(() => {
        setTestResult({ ok: false, message: '企业微信配置加载失败，请检查后端服务' });
      });
    return () => { active = false; };
  }, []);

  const getWecomPayload = () => ({
    wecomCorpId: config.corpid.trim(),
    wecomAgentId: config.agentId.trim(),
    wecomCorpSecret: config.secret.trim(),
    wecomToken: config.token.trim(),
    wecomEncodingAesKey: config.encodingAesKey.trim(),
    wecomCallbackUrl: config.callbackUrl.trim(),
    wecomTemplates: {
      urge: config.notifTemplateUrge,
      warning: config.notifTemplateWarning,
      done: config.notifTemplateDone,
    },
  });

  const handleSave = async () => {
    setIsSaving(true);
    setTestResult(null);
    try {
      await api.globalRules.update(getWecomPayload());
      addLog({
        userName: currentUser.name,
        userId: currentUser.id,
        action: '保存企业微信配置',
        module: '企业微信配置'
      });
      setConfig((current) => ({ ...current, secret: current.secret ? SECRET_MASK : '' }));
      showToast('企业微信配置已保存', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '企业微信配置保存失败';
      setTestResult({ ok: false, message });
      showToast(message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      const result = await api.globalRules.testWecom(getWecomPayload());
      addLog({
        userName: currentUser.name,
        userId: currentUser.id,
        action: '测试企业微信连接',
        module: '企业微信配置'
      });
      setTestResult({ ok: result.ok, message: result.message });
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : '企业微信连接测试失败' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestVerify = async () => {
    setIsTesting(true);
    try {
      const result = await api.globalRules.verifyWecom(getWecomPayload());
      setTestResult({ ok: result.ok, message: result.message });
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : '回调验签测试失败' });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">企业微信配置</h1>
          <p className="text-slate-500 text-sm mt-1">维护企业微信免登、消息模板、待办回跳参数与验签配置。</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleTestConnection}
            disabled={isTesting}
            className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-semibold hover:bg-slate-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <TestTube className="w-4 h-4" />
            <span>{isTesting ? '测试中...' : '测试连接'}</span>
          </button>
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? '保存中...' : '保存配置'}</span>
          </button>
        </div>
      </div>

      {testResult && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mb-6 p-4 rounded-2xl border flex items-center gap-3 ${
            testResult.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
          }`}
        >
          {testResult.ok ? (
            <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          )}
          <div>
            <p className={`text-sm font-bold ${testResult.ok ? 'text-green-800' : 'text-red-800'}`}>
              {testResult.ok ? '测试通过' : '测试失败'}
            </p>
            <p className={`text-xs ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
              {testResult.message}
            </p>
          </div>
          <button 
            onClick={() => setTestResult(null)}
            className="ml-auto text-slate-400 hover:text-slate-600"
          >
            <AlertCircle className="w-4 h-4" />
          </button>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 基础接入配置 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-6">基础接入参数</h3>
          <div className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">企业 ID (CorpID)</label>
              <input 
                type="text"
                className="w-full bg-slate-50 border border-slate-100 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                value={config.corpid}
                onChange={(e) => setConfig({ ...config, corpid: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">应用 AgentId</label>
              <input 
                type="text"
                className="w-full bg-slate-50 border border-slate-100 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                value={config.agentId}
                onChange={(e) => setConfig({ ...config, agentId: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">应用 Secret</label>
              <div className="relative">
                <input 
                  type={showSecret ? 'text' : 'password'}
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl py-3 px-4 pr-12 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                  value={config.secret}
                  onChange={(e) => setConfig({ ...config, secret: e.target.value })}
                  placeholder="请输入企业微信应用 Secret，支持较长密钥"
                  autoComplete="new-password"
                  minLength={16}
                  maxLength={512}
                />
                <button 
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Token</label>
              <input 
                type="text"
                className="w-full bg-slate-50 border border-slate-100 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                value={config.token}
                onChange={(e) => setConfig({ ...config, token: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">EncodingAESKey</label>
              <input 
                type="text"
                className="w-full bg-slate-50 border border-slate-100 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                value={config.encodingAesKey}
                onChange={(e) => setConfig({ ...config, encodingAesKey: e.target.value })}
                placeholder="用于消息加密的AES密钥"
              />
            </div>
          </div>
        </div>

        {/* 回调与免登配置 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-6">回调与免登配置</h3>
          <div className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">回调 URL</label>
              <input 
                type="text"
                className="w-full bg-slate-50 border border-slate-100 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                value={config.callbackUrl}
                onChange={(e) => setConfig({ ...config, callbackUrl: e.target.value })}
              />
              <p className="text-[10px] text-slate-400 mt-1">企业微信消息与事件回调地址，需在企业微信管理后台配置</p>
            </div>
            <div className="pt-2">
              <button 
                onClick={handleTestVerify}
                disabled={isTesting}
                className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-medium hover:bg-slate-50 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Wrench className="w-4 h-4" />
                {isTesting ? '验签中...' : '回调验签测试'}
              </button>
            </div>
          </div>
        </div>

        {/* 消息模板 */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-6">消息通知模板</h3>
          <p className="text-xs text-slate-400 mb-4">支持变量替换：<code className="bg-slate-100 px-1 py-0.5 rounded">{'{事项标题}'}</code> <code className="bg-slate-100 px-1 py-0.5 rounded">{'{负责人}'}</code> <code className="bg-slate-100 px-1 py-0.5 rounded">{'{截止日期}'}</code></p>
          <div className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">催办消息模板</label>
              <textarea 
                rows={2}
                className="w-full bg-slate-50 border border-slate-100 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none resize-none"
                value={config.notifTemplateUrge}
                onChange={(e) => setConfig({ ...config, notifTemplateUrge: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">超期预警模板</label>
              <textarea 
                rows={2}
                className="w-full bg-slate-50 border border-slate-100 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none resize-none"
                value={config.notifTemplateWarning}
                onChange={(e) => setConfig({ ...config, notifTemplateWarning: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">完成归档通知模板</label>
              <textarea 
                rows={2}
                className="w-full bg-slate-50 border border-slate-100 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none resize-none"
                value={config.notifTemplateDone}
                onChange={(e) => setConfig({ ...config, notifTemplateDone: e.target.value })}
              />
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default WecomSettings;
