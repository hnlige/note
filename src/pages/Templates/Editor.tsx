import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MainLayout } from '../../components/Layout/MainLayout';
import { useStore } from '../../store/useStore';
import { 
  ChevronLeft, 
  Save, 
  Eye, 
  Settings, 
  Clock, 
  User, 
  FileText,
  Calendar,
  Info
} from 'lucide-react';
import { motion } from 'framer-motion';

const TemplateEditor: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { templates, updateTemplate } = useStore();
  const [formData, setFormData] = useState(templates.find(t => t.id === id) || templates[0]);

  useEffect(() => {
    const template = templates.find(t => t.id === id);
    if (template) setFormData(template);
  }, [id, templates]);

  const handleSave = () => {
    updateTemplate(formData);
    navigate('/templates');
  };

  return (
    <MainLayout>
      <div className="mb-8">
        <button 
          onClick={() => navigate('/templates')}
          className="flex items-center gap-1 text-slate-500 hover:text-slate-900 font-semibold transition-colors mb-4"
        >
          <ChevronLeft className="w-4 h-4" />
          返回模板列表
        </button>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">编辑模板</h1>
            <span className="text-sm font-medium text-slate-400">ID: {formData.id}</span>
          </div>
          <button 
            onClick={handleSave}
            className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 transition-all shadow-md shadow-blue-100 active:scale-95"
          >
            <Save className="w-4 h-4" />
            保存配置
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Left: Configuration Form */}
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
            <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
              <Settings className="w-5 h-5 text-blue-600" />
              基础配置
            </h3>
            
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">模板名称</label>
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">业务分类</label>
                <select 
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
                >
                  <option value="行政管理">行政管理</option>
                  <option value="工程建设">工程建设</option>
                  <option value="科研教育">科研教育</option>
                  <option value="信息化建设">信息化建设</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">描述说明</label>
                <textarea 
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all resize-none"
                />
              </div>
            </div>
          </div>

          <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
            <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
              <Clock className="w-5 h-5 text-orange-600" />
              默认规则与人员
            </h3>
            
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">默认执行天数</label>
                <div className="relative">
                  <input 
                    type="number" 
                    value={formData.defaultDeadlineDays}
                    onChange={(e) => setFormData({ ...formData, defaultDeadlineDays: parseInt(e.target.value) })}
                    className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">天</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">默认跟进人</label>
                <select 
                  value={formData.defaultFollowerId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const name = id === '3' ? '王跟进' : '李督办';
                    setFormData({ ...formData, defaultFollowerId: id, defaultFollowerName: name });
                  }}
                  className="w-full bg-slate-50 border-none rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
                >
                  <option value="3">王跟进</option>
                  <option value="4">李督办</option>
                </select>
              </div>
            </div>

            <div className="mt-8 p-4 bg-orange-50 rounded-xl flex gap-3">
              <Info className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-orange-900 mb-1">规则生效说明</p>
                <p className="text-xs text-orange-700 leading-relaxed">
                  以上配置将在通过该模板发起督办时作为初始默认值。发件人仍可在发起时进行手动覆盖。
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live Preview */}
        <div className="space-y-6">
          <div className="bg-slate-900 rounded-2xl shadow-xl overflow-hidden flex flex-col h-full min-h-[600px]">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">发件表单实时预览</span>
              </div>
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
              </div>
            </div>
            
            <div className="flex-1 p-8 bg-slate-50 overflow-y-auto">
              <motion.div 
                key={formData.name}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-md mx-auto bg-white rounded-2xl shadow-lg border border-slate-200 p-8"
              >
                <div className="flex items-center gap-2 mb-6">
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded uppercase">New Supervision</span>
                  <span className="text-xs font-bold text-slate-400">模板: {formData.name}</span>
                </div>

                <div className="space-y-6 pointer-events-none">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">事项标题</label>
                    <div className="h-10 bg-slate-50 rounded-lg border border-slate-100 border-dashed" />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">具体要求</label>
                    <div className="h-24 bg-slate-50 rounded-lg border border-slate-100 border-dashed" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">截止日期 (预设)</label>
                      <div className="h-10 bg-blue-50/30 rounded-lg border border-blue-100 flex items-center px-3 gap-2">
                        <Calendar className="w-4 h-4 text-blue-400" />
                        <span className="text-xs font-bold text-blue-600">T + {formData.defaultDeadlineDays} 天</span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">跟进人 (预设)</label>
                      <div className="h-10 bg-blue-50/30 rounded-lg border border-blue-100 flex items-center px-3 gap-2">
                        <User className="w-4 h-4 text-blue-400" />
                        <span className="text-xs font-bold text-blue-600">{formData.defaultFollowerName}</span>
                      </div>
                    </div>
                  </div>

                  <button className="w-full bg-blue-600 h-12 rounded-xl mt-8 flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span className="text-sm font-bold text-white opacity-50">正在根据模板生成...</span>
                  </button>
                </div>
              </motion.div>
            </div>
            
            <div className="p-4 bg-slate-800 text-center">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Interactive Mockup v1.0
              </p>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default TemplateEditor;
