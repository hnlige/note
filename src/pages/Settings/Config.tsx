import React, { useState } from 'react';
import { MainLayout } from '../../components/Layout/MainLayout';
import { useStore } from '../../store/useStore';
import { useToast } from '../../components/Common/Toast';
import { DictionaryItem } from '../../types';
import { 
  Settings2, 
  Bell, 
  Zap, 
  Shield, 
  Database, 
  Save,
  CheckCircle2,
  Mail,
  MessageSquare,
  Smartphone,
  Plus,
  Trash2,
  Edit2,
  X,
  FileText,
  Workflow,
  Type,
  Hash,
  Calendar,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const DEFAULT_CONFIG = {
  yellowLightDays: 3,
  redLightHours: 24,
  autoUrgeFrequency: 1,
  autoRemindEnabled: true,
  autoUrgeEnabled: false,
  urgeChannels: ['SYSTEM'] as string[],
  serialRule: { prefix: 'DB', showYear: true, sequenceLength: 3, connector: '-' },
  notifTemplates: { urge: '', warning: '', audit: '' },
  auditFlow: { enableMultiLevel: false, auditRoles: ['ADMIN'] as string[] },
};

const SystemConfig: React.FC = () => {
  const { addLog, currentUser, dictionaries, addDictionaryItem, updateDictionaryItem, deleteDictionaryItem, globalRules, updateGlobalRules, roles } = useStore();
  const { showToast } = useToast();
  const [config, setConfig] = useState(globalRules || DEFAULT_CONFIG);
  const [isDictModalOpen, setIsDictModalOpen] = useState(false);
  const [editingDict, setEditingDict] = useState<{ id?: string, label: string, type: 'CATEGORY' | 'CAMPUS' | 'MEETING_SOURCE' | 'URGENCY' | 'DELAY_REASON' | 'EVAL_TAG' } | null>(null);
  const [activeTab, setActiveTab] = useState<'GENERAL' | 'NOTIF' | 'AUDIT' | 'DICT'>('GENERAL');

  const handleSave = async () => {
    try {
      await updateGlobalRules(config);
      addLog({
        userName: currentUser.name,
        userId: currentUser.id,
        action: '更新系统基础配置',
        module: '系统设置'
      });
      showToast('配置已成功保存', 'success');
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : '配置保存失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  const renderDictSection = (title: string, type: DictionaryItem['type']) => {
    const items = dictionaries.filter(d => d.type === type);
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">{title}</h4>
            <span className="bg-slate-100 text-slate-500 text-[10px] px-1.5 py-0.5 rounded-md font-mono">
              {items.length}
            </span>
          </div>
          <button 
            onClick={() => {
              setEditingDict({ label: '', type });
              setIsDictModalOpen(true);
            }}
            className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-bold hover:bg-blue-600 hover:text-white transition-all border border-blue-100"
          >
            <Plus className="w-3 h-3" />
            新增
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map(item => (
            <div key={item.id} className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl hover:shadow-md hover:border-blue-100 transition-all group">
              <div className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                <span className="text-sm font-bold text-slate-700">{item.label}</span>
              </div>
              <div className="flex items-center gap-1">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingDict({ id: item.id, label: item.label, type: item.type });
                    setIsDictModalOpen(true);
                  }}
                  className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                  title="编辑"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`确定要删除字典项 "${item.label}" 吗？`)) {
                      deleteDictionaryItem(item.id);
                      addLog({
                        userName: currentUser.name,
                        userId: currentUser.id,
                        action: `删除字典项: ${item.label}`,
                        module: '业务字典'
                      });
                    }
                  }}
                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                  title="删除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <div className="col-span-full py-8 flex flex-col items-center justify-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
              <Database className="w-8 h-8 text-slate-200 mb-2" />
              <p className="text-xs text-slate-400 font-medium">暂无数据，请点击上方“新增”</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const tabs = [
    { id: 'GENERAL', label: '通用与规则', icon: Settings2 },
    { id: 'NOTIF', label: '通知模板', icon: Bell },
    { id: 'AUDIT', label: '审核流程', icon: Workflow },
    { id: 'DICT', label: '业务字典', icon: Database },
  ];

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">系统基础配置</h1>
          <p className="text-slate-500 text-sm mt-1">管理系统全局参数、预警阈值及基础业务规则。</p>
        </div>
        <button 
          onClick={handleSave}
          className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 transition-all shadow-md shadow-blue-100 active:scale-95"
        >
          <Save className="w-4 h-4" />
          <span>保存配置</span>
        </button>
      </div>

      <div className="flex gap-8">
        {/* Left Sidebar Tabs */}
        <div className="w-64 shrink-0 space-y-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                activeTab === tab.id 
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' 
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Right Content Area */}
        <div className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            {activeTab === 'GENERAL' && (
              <motion.div
                key="general"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                {/* Serial Number Rules */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 space-y-6">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                      <Hash className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">督办字号生成规则</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">字号前缀</label>
                        <input 
                          type="text" 
                          value={config.serialRule.prefix}
                          onChange={(e) => setConfig({
                            ...config,
                            serialRule: { ...config.serialRule, prefix: e.target.value }
                          })}
                          className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">流水号长度</label>
                        <input 
                          type="number" 
                          value={config.serialRule.sequenceLength}
                          onChange={(e) => setConfig({
                            ...config,
                            serialRule: { ...config.serialRule, sequenceLength: parseInt(e.target.value) }
                          })}
                          className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all"
                        />
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">连接符</label>
                        <input 
                          type="text" 
                          value={config.serialRule.connector}
                          onChange={(e) => setConfig({
                            ...config,
                            serialRule: { ...config.serialRule, connector: e.target.value }
                          })}
                          className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all"
                        />
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl mt-6">
                        <span className="text-sm font-bold text-slate-700">包含年份</span>
                        <button 
                          onClick={() => setConfig({
                            ...config,
                            serialRule: { ...config.serialRule, showYear: !config.serialRule.showYear }
                          })}
                          className={`w-10 h-5 rounded-full transition-colors relative ${config.serialRule.showYear ? 'bg-blue-600' : 'bg-slate-300'}`}
                        >
                          <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${config.serialRule.showYear ? 'left-6' : 'left-1'}`} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                    <p className="text-xs text-blue-600 font-bold uppercase mb-1">预览效果</p>
                    <p className="text-lg font-mono font-bold text-blue-700 tracking-wider">
                      {config.serialRule.prefix}
                      {config.serialRule.showYear ? `${config.serialRule.connector}${new Date().getFullYear()}` : ''}
                      {config.serialRule.connector}
                      {'0'.repeat(config.serialRule.sequenceLength - 1)}1
                    </p>
                  </div>
                </div>

                {/* Pre-warning & Urge */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 space-y-6">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-red-600">
                      <Zap className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">预警与催办</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <label className="block text-xs font-bold text-slate-400 uppercase">亮灯阈值</label>
                      <div className="flex items-center gap-4">
                        <span className="text-sm text-slate-600">距离截止日期</span>
                        <input 
                          type="number" 
                          value={config.yellowLightDays}
                          onChange={(e) => setConfig({ ...config, yellowLightDays: parseInt(e.target.value) })}
                          className="w-20 bg-slate-50 border-none rounded-lg py-2 px-3 text-sm font-bold"
                        />
                        <span className="text-sm text-slate-600 text-yellow-600 font-bold">亮黄灯</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-sm text-slate-600">超过截止日期</span>
                        <input 
                          type="number" 
                          value={config.redLightHours}
                          onChange={(e) => setConfig({ ...config, redLightHours: parseInt(e.target.value) })}
                          className="w-20 bg-slate-50 border-none rounded-lg py-2 px-3 text-sm font-bold"
                        />
                        <span className="text-sm text-slate-600 text-red-600 font-bold">亮红灯 (小时)</span>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <label className="block text-xs font-bold text-slate-400 uppercase">自动催办频率</label>
                      <div className="flex items-center gap-4">
                        <span className="text-sm text-slate-600">亮灯后每隔</span>
                        <input 
                          type="number" 
                          value={config.autoUrgeFrequency}
                          onChange={(e) => setConfig({ ...config, autoUrgeFrequency: parseInt(e.target.value) })}
                          className="w-20 bg-slate-50 border-none rounded-lg py-2 px-3 text-sm font-bold"
                        />
                        <span className="text-sm text-slate-600">天自动催办</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                        <div>
                          <p className="text-sm font-bold text-slate-700">发送超期提醒</p>
                          <p className="text-xs text-slate-400 mt-0.5">关闭后，系统仍更新状态和亮灯，但不发送超期消息</p>
                        </div>
                        <button
                          type="button"
                          aria-label="发送超期提醒"
                          aria-pressed={config.autoRemindEnabled}
                          onClick={() => setConfig({ ...config, autoRemindEnabled: !config.autoRemindEnabled })}
                          className={`w-10 h-5 rounded-full transition-colors relative ${config.autoRemindEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}
                        >
                          <span className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${config.autoRemindEnabled ? 'left-6' : 'left-1'}`} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                        <div>
                          <p className="text-sm font-bold text-slate-700">启用系统自动催办</p>
                          <p className="text-xs text-slate-400 mt-0.5">仅开启后，系统才按上方频率生成自动催办记录</p>
                        </div>
                        <button
                          type="button"
                          aria-label="启用系统自动催办"
                          aria-pressed={config.autoUrgeEnabled}
                          onClick={() => setConfig({ ...config, autoUrgeEnabled: !config.autoUrgeEnabled })}
                          className={`w-10 h-5 rounded-full transition-colors relative ${config.autoUrgeEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}
                        >
                          <span className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${config.autoUrgeEnabled ? 'left-6' : 'left-1'}`} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'NOTIF' && (
              <motion.div
                key="notif"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 space-y-8"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600">
                    <FileText className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">通知内容模板自定义</h3>
                </div>

                <div className="space-y-6">
                  {[
                    { id: 'urge', label: '自动催办消息模板', desc: '用于系统亮灯后的自动推送文案' },
                    { id: 'warning', label: '亮灯预警消息模板', desc: '用于红黄灯初次亮起时的预警提醒' },
                    { id: 'audit', label: '审核任务提醒模板', desc: '用于通知管理员有新的办结申请待审' },
                  ].map(tmpl => (
                    <div key={tmpl.id} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-bold text-slate-700">{tmpl.label}</p>
                          <p className="text-[10px] text-slate-400 font-medium">{tmpl.desc}</p>
                        </div>
                        <div className="flex gap-2">
                          {['{title}', '{serialNo}', '{deadline}'].map(tag => (
                            <button 
                              key={tag}
                              onClick={() => {
                                const val = (config.notifTemplates as any)[tmpl.id] + tag;
                                setConfig({ ...config, notifTemplates: { ...config.notifTemplates, [tmpl.id]: val } });
                              }}
                              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-[10px] font-mono text-slate-600 transition-colors"
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      </div>
                      <textarea 
                        value={(config.notifTemplates as any)[tmpl.id]}
                        onChange={(e) => setConfig({ ...config, notifTemplates: { ...config.notifTemplates, [tmpl.id]: e.target.value } })}
                        className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all min-h-[80px] resize-none"
                      />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'AUDIT' && (
              <motion.div
                key="audit"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 space-y-8"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center text-purple-600">
                    <Workflow className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">多级审核流程定义</h3>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center justify-between p-6 bg-slate-50 rounded-2xl border border-slate-100">
                    <div>
                      <p className="text-sm font-bold text-slate-900">开启多级并签审核</p>
                      <p className="text-xs text-slate-500 mt-1">开启后，事项办结需要多个指定角色全部通过</p>
                    </div>
                    <button 
                      onClick={() => setConfig({ ...config, auditFlow: { ...config.auditFlow, enableMultiLevel: !config.auditFlow.enableMultiLevel } })}
                      className={`w-12 h-6 rounded-full transition-colors relative ${config.auditFlow.enableMultiLevel ? 'bg-blue-600' : 'bg-slate-300'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${config.auditFlow.enableMultiLevel ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">指定审核角色</label>
                    <div className="grid grid-cols-2 gap-4">
                      {roles.map(role => (
                        <button
                          key={role.id}
                          onClick={() => {
                            const newRoles = config.auditFlow.auditRoles.includes(role.name)
                              ? config.auditFlow.auditRoles.filter(r => r !== role.name)
                              : [...config.auditFlow.auditRoles, role.name];
                            setConfig({ ...config, auditFlow: { ...config.auditFlow, auditRoles: newRoles } });
                          }}
                          className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                            config.auditFlow.auditRoles.includes(role.name)
                              ? 'bg-blue-50 border-blue-200 text-blue-600'
                              : 'bg-white border-slate-100 text-slate-400 hover:border-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <Shield className="w-4 h-4" />
                            <span className="text-sm font-bold">{role.name}</span>
                          </div>
                          {config.auditFlow.auditRoles.includes(role.name) && <CheckCircle2 className="w-4 h-4" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'DICT' && (
              <motion.div
                key="dict"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 space-y-12"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center text-green-600">
                    <Database className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">扩展业务字典</h3>
                </div>

                <div className="space-y-12">
                  <div className="grid grid-cols-1 gap-8">
                    {renderDictSection('事项分类', 'CATEGORY')}
                    <div className="h-px bg-slate-50" />
                    {renderDictSection('院区管理', 'CAMPUS')}
                    <div className="h-px bg-slate-50" />
                    {renderDictSection('会议来源', 'MEETING_SOURCE')}
                    <div className="h-px bg-slate-50" />
                    {renderDictSection('事项紧急程度', 'URGENCY')}
                    <div className="h-px bg-slate-50" />
                    {renderDictSection('延期原因分类', 'DELAY_REASON')}
                    <div className="h-px bg-slate-50" />
                    {renderDictSection('效能评价标签库', 'EVAL_TAG')}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Add/Edit Dictionary Modal */}
      <AnimatePresence>
        {isDictModalOpen && editingDict && (
          <div className="fixed inset-0 flex items-center justify-center z-[100] p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDictModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                <h3 className="font-bold text-slate-900">{editingDict.id ? '编辑字典项' : '新增字典项'}</h3>
                <button onClick={() => setIsDictModalOpen(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">名称</label>
                  <input 
                    type="text" 
                    value={editingDict.label}
                    onChange={(e) => setEditingDict({ ...editingDict, label: e.target.value })}
                    placeholder="请输入字典项名称..."
                    className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all"
                    autoFocus
                  />
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                <button 
                  onClick={() => setIsDictModalOpen(false)}
                  className="px-6 py-2 text-slate-500 font-bold text-sm hover:bg-white rounded-xl transition-all"
                >
                  取消
                </button>
                <button 
                  onClick={() => {
                    if (editingDict.label) {
                      if (editingDict.id) {
                        updateDictionaryItem(editingDict.id, { label: editingDict.label });
                      } else {
                        addDictionaryItem({ label: editingDict.label, type: editingDict.type });
                      }
                      setIsDictModalOpen(false);
                    }
                  }}
                  className="px-6 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
                >
                  确认{editingDict.id ? '保存' : '新增'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </MainLayout>
  );
};

export default SystemConfig;
