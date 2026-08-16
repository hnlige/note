import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Download, 
  Upload, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Clock, 
  FileText,
  X
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useNavigate } from 'react-router-dom';

interface TaskCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TaskCenter: React.FC<TaskCenterProps> = ({ isOpen, onClose }) => {
  const { asyncTasks, updateAsyncTask } = useStore();
  const navigate = useNavigate();

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PROCESSING': return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'COMPLETED': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'FAILED': return <XCircle className="w-4 h-4 text-red-500" />;
      default: return <Clock className="w-4 h-4 text-slate-400" />;
    }
  };

  const handleDownload = (taskName: string) => {
    const csvContent = `任务名称,${taskName}\n生成时间,${new Date().toLocaleString()}\n状态,已完成\n---\n明细数据,请从导出服务获取完整文件`;
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${taskName}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClear = (taskId: string) => {
    updateAsyncTask(taskId, { status: 'COMPLETED' as const });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/20 backdrop-blur-[2px] z-[80]"
          />
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="fixed right-6 top-20 w-[400px] bg-white rounded-2xl shadow-2xl border border-slate-100 z-[90] overflow-hidden"
          >
            <div className="p-4 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-white" />
                </div>
                <h3 className="font-bold text-slate-900">任务中心</h3>
              </div>
              <button onClick={onClose} className="p-1 hover:bg-white rounded-md transition-colors">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <div className="max-h-[480px] overflow-y-auto p-4 custom-scrollbar">
              <div className="space-y-4">
                {asyncTasks.length > 0 ? asyncTasks.map((task) => (
                  <div key={task.id} className="p-4 rounded-xl border border-slate-50 bg-white hover:bg-slate-50 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${task.type === 'IMPORT' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'}`}>
                        {task.type === 'IMPORT' ? <Upload className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h4 className="text-sm font-bold text-slate-900 truncate pr-2">{task.name}</h4>
                          {getStatusIcon(task.status)}
                        </div>
                        
                        <div className="mt-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{task.startTime}</span>
                            <span className="text-[10px] font-bold text-blue-600">{task.progress}%</span>
                          </div>
                          <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${task.progress}%` }}
                              className={`h-full ${task.status === 'FAILED' ? 'bg-red-500' : 'bg-blue-600'}`}
                            />
                          </div>
                        </div>

                        {task.status === 'COMPLETED' && (
                          <div className="mt-3 flex items-center gap-2">
                            {task.result && (
                              <span className="text-[10px] text-slate-500 bg-slate-50 px-2 py-1 rounded">{task.result}</span>
                            )}
                            {task.type === 'EXPORT' && (
                              <button 
                                onClick={() => handleDownload(task.name)}
                                className="text-[10px] font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-2 py-1 rounded transition-colors"
                              >
                                下载结果
                              </button>
                            )}
                            <button 
                              onClick={() => handleClear(task.id)}
                              className="text-[10px] font-bold text-slate-400 hover:text-slate-600 px-2 py-1 rounded transition-colors"
                            >
                              清理
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="py-12 flex flex-col items-center justify-center text-slate-300">
                    <Loader2 className="w-12 h-12 mb-3 opacity-10" />
                    <p className="text-xs font-bold">暂无正在处理的任务</p>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-slate-50 bg-slate-50/30">
              <button
                onClick={() => {
                  onClose();
                  navigate('/system/tasks');
                }}
                className="w-full py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors"
              >
                查看所有历史任务
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
