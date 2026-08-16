import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '../../components/Layout/MainLayout';
import { useStore } from '../../store/useStore';
import { Template } from '../../types';
import { 
  Plus, 
  Settings2, 
  Copy, 
  Trash2, 
  ChevronRight, 
  FileText,
  Clock,
  User,
  Activity
} from 'lucide-react';
import { motion } from 'framer-motion';

const Templates: React.FC = () => {
  const navigate = useNavigate();
  const { templates, addTemplate, deleteTemplate, publishTemplate, unpublishTemplate, addLog, currentUser } = useStore();

  const handleCreate = () => {
    const newTemplate = {
      name: `新督办模板 ${templates.length + 1}`,
      category: '通用分类',
      description: '点击编辑以完善模板的具体描述和预设规则。',
      defaultDeadlineDays: 7,
      defaultFollowerId: '3',
      defaultFollowerName: '王跟进',
      status: 'DRAFT' as const,
      rules: { yellowLightDays: 3, redLightHours: 24 }
    };
    addTemplate(newTemplate);
    addLog({
      userName: currentUser.name,
      userId: currentUser.id,
      action: '创建新模板',
      module: '模板管理'
    });
  };

  const handleClone = (template: Template) => {
    const { id, ...rest } = template;
    addTemplate({
      ...rest,
      name: `${template.name} (副本)`
    });
    addLog({
      userName: currentUser.name,
      userId: currentUser.id,
      action: `克隆模板: ${template.name}`,
      module: '模板管理'
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`确定要删除模板【${name}】吗？此操作不可撤销。`)) {
      deleteTemplate(id);
      addLog({
        userName: currentUser.name,
        userId: currentUser.id,
        action: `删除模板: ${name}`,
        module: '模板管理'
      });
    }
  };

  const handlePublish = (id: string, name: string) => {
    if (confirm(`确定要发布模板【${name}】吗？发布后该模板可用于新建督办事项。`)) {
      publishTemplate(id);
      addLog({
        userName: currentUser.name,
        userId: currentUser.id,
        action: `发布模板: ${name}`,
        module: '模板管理'
      });
    }
  };

  const handleUnpublish = (id: string, name: string) => {
    if (confirm(`确定要停用模板【${name}】吗？停用后新建事项将无法选择此模板，已有事项不受影响。`)) {
      unpublishTemplate(id);
      addLog({
        userName: currentUser.name,
        userId: currentUser.id,
        action: `停用模板: ${name}`,
        module: '模板管理'
      });
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">模板管理</h1>
          <p className="text-slate-500 text-sm mt-1">配置标准化的督办模板，预设执行规则与责任关系。</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => navigate('/templates/rules')}
            className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-semibold hover:bg-slate-50 transition-all"
          >
            <Settings2 className="w-4 h-4" />
            <span>全局规则配置</span>
          </button>
          <button 
            onClick={handleCreate}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-all shadow-sm active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>新建模板</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {templates.map((template, index) => (
          <motion.div
            key={template.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all flex flex-col group"
          >
            <div className="p-6 flex-1">
              <div className="flex items-center justify-between mb-4">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                  <FileText className="w-6 h-6" />
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    template.status === 'PUBLISHED' ? 'bg-green-50 text-green-600' 
                    : template.status === 'DRAFT' ? 'bg-amber-50 text-amber-600' 
                    : 'bg-slate-100 text-slate-400'
                  }`}>
                    {template.status === 'PUBLISHED' ? '已发布' : template.status === 'DRAFT' ? '草稿' : '已停用'}
                  </span>
                </div>
              </div>
              
              <h3 className="text-lg font-bold text-slate-900 mb-2 group-hover:text-blue-600 transition-colors">
                {template.name}
              </h3>
              <p className="text-sm text-slate-500 line-clamp-2 mb-6">
                {template.description}
              </p>

              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-slate-400 flex items-center gap-1.5 uppercase">
                    <Clock className="w-3.5 h-3.5" />
                    默认时限
                  </span>
                  <span className="text-slate-900">{template.defaultDeadlineDays} 天</span>
                </div>
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-slate-400 flex items-center gap-1.5 uppercase">
                    <User className="w-3.5 h-3.5" />
                    默认跟进
                  </span>
                  <span className="text-slate-900">{template.defaultFollowerName}</span>
                </div>
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-slate-400 flex items-center gap-1.5 uppercase">
                    <Activity className="w-3.5 h-3.5" />
                    亮灯阈值
                  </span>
                  <span className="text-slate-900">黄{template.rules.yellowLightDays}d / 红{template.rules.redLightHours}h</span>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-50 bg-slate-50/30 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1">
                {template.status === 'DRAFT' && (
                  <button 
                    onClick={() => handlePublish(template.id, template.name)}
                    className="flex items-center gap-1 px-2 py-1.5 text-xs font-bold text-green-600 bg-green-50 hover:bg-green-100 rounded-lg transition-all" 
                    title="发布"
                  >
                    发布
                  </button>
                )}
                {template.status === 'PUBLISHED' && (
                  <button 
                    onClick={() => handleUnpublish(template.id, template.name)}
                    className="flex items-center gap-1 px-2 py-1.5 text-xs font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all" 
                    title="停用"
                  >
                    停用
                  </button>
                )}
                <button 
                  onClick={() => handleClone(template)}
                  className="p-2 text-slate-400 hover:text-blue-600 hover:bg-white rounded-lg transition-all" 
                  title="克隆"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => handleDelete(template.id, template.name)}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-white rounded-lg transition-all" 
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <button 
                onClick={() => navigate(`/templates/${template.id}/edit`)}
                className="flex items-center gap-1 text-sm font-bold text-blue-600 hover:text-blue-700 px-3 py-1.5 hover:bg-white rounded-lg transition-all"
              >
                编辑配置
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </MainLayout>
  );
};

export default Templates;
