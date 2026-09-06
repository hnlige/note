import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MainLayout } from '../../components/Layout/MainLayout';
import { useStore } from '../../store/useStore';
import {
  Activity,
  RefreshCw,
  Pause,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
  Search,
  ArrowUpRight,
  X
} from 'lucide-react';
import { motion } from 'framer-motion';

const TASK_REFRESH_INTERVAL_MS = 8000;

const TaskMonitor: React.FC = () => {
  const { asyncTasks, updateAsyncTask, fetchAsyncTasks } = useStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTask, setSelectedTask] = useState<(typeof asyncTasks)[number] | null>(null);
  // 定时器仅用于轮询刷新，任务数据以服务端 async_tasks 表为准
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchAsyncTasks();
    refreshTimerRef.current = setInterval(() => {
      fetchAsyncTasks();
    }, TASK_REFRESH_INTERVAL_MS);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [fetchAsyncTasks]);

  const filteredTasks = useMemo(() => {
    if (!searchTerm) return asyncTasks;
    const q = searchTerm.toLowerCase();
    return asyncTasks.filter(t => t.name.toLowerCase().includes(q));
  }, [asyncTasks, searchTerm]);

  const stats = useMemo(() => {
    const completed = asyncTasks.filter(t => t.status === 'COMPLETED').length;
    const failed = asyncTasks.filter(t => t.status === 'FAILED').length;
    const processing = asyncTasks.filter(t => t.status === 'PROCESSING').length;
    const pending = asyncTasks.filter(t => t.status === 'PENDING').length;
    return { completed, failed, processing, pending, total: asyncTasks.length };
  }, [asyncTasks]);

  const handleRetry = (id: string) => {
    updateAsyncTask(id, { status: 'PROCESSING', progress: 0 });
  };

  const handlePause = (id: string) => {
    updateAsyncTask(id, { status: 'PENDING' });
  };

  const handleResume = (id: string) => {
    updateAsyncTask(id, { status: 'PROCESSING' });
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'bg-green-50 text-green-600';
      case 'FAILED': return 'bg-red-50 text-red-600';
      case 'PROCESSING': return 'bg-blue-50 text-blue-600';
      case 'PENDING': return 'bg-slate-100 text-slate-600';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'COMPLETED': return '已完成';
      case 'FAILED': return '失败';
      case 'PROCESSING': return '运行中';
      case 'PENDING': return '等待中';
      default: return status;
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">任务监控与重跑</h1>
          <p className="text-slate-500 text-sm mt-1">监控自动催办、超期扫描、组织同步、消息推送等任务健康状态。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        {[
          { label: '任务总数', value: stats.total, icon: Activity, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: '运行中', value: stats.processing, icon: Play, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: '已完成', value: stats.completed, icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
          { label: '失败', value: stats.failed, icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' },
        ].map(stat => (
          <div key={stat.label} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase">{stat.label}</span>
              <div className={`p-2 rounded-xl ${stat.bg} ${stat.color}`}>
                <stat.icon className="w-4 h-4" />
              </div>
            </div>
            <h3 className="text-3xl font-bold text-slate-900">{stat.value}</h3>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-50 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            任务列表
          </h3>
          <div className="relative max-w-xs w-full">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="搜索任务名称..."
              className="w-full bg-slate-50 border-none rounded-lg py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50/50 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
              <th className="px-6 py-4">任务名称</th>
              <th className="px-6 py-4">模块</th>
              <th className="px-6 py-4">进度</th>
              <th className="px-6 py-4">状态</th>
              <th className="px-6 py-4">开始时间</th>
              <th className="px-6 py-4 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredTasks.map(task => (
              <motion.tr
                key={task.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="group hover:bg-slate-50/50 transition-colors"
              >
                <td className="px-6 py-4">
                  <p className="text-sm font-bold text-slate-900">{task.name}</p>
                </td>
                <td className="px-6 py-4">
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-purple-50 text-purple-600">
                    {task.module || (task.type === 'IMPORT' ? '导入' : '导出')}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden max-w-[120px]">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          task.status === 'COMPLETED' ? 'bg-green-500' :
                          task.status === 'FAILED' ? 'bg-red-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold text-slate-500">{task.progress}%</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${getStatusStyle(task.status)}`}>
                    {getStatusText(task.status)}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Clock className="w-3.5 h-3.5" />
                    <span className="text-xs">{task.startTime}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {task.status === 'FAILED' && (
                      <button
                        onClick={() => handleRetry(task.id)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                        title="重跑"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    )}
                    {task.status === 'PROCESSING' && (
                      <button
                        onClick={() => handlePause(task.id)}
                        className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg transition-all"
                        title="暂停"
                      >
                        <Pause className="w-4 h-4" />
                      </button>
                    )}
                    {task.status === 'PENDING' && (
                      <button
                        onClick={() => handleResume(task.id)}
                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-all"
                        title="恢复"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedTask(task)}
                      className="p-2 text-slate-400 hover:bg-slate-50 rounded-lg transition-all"
                      title="查看详情"
                    >
                      <ArrowUpRight className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </motion.tr>
            ))}
            {filteredTasks.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400 font-medium">
                  暂无任务记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedTask && (
        <div className="fixed inset-0 flex items-center justify-center z-[100] p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setSelectedTask(null)} />
          <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-50 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900">任务详情</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">ID: {selectedTask.id}</p>
              </div>
              <button onClick={() => setSelectedTask(null)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-8 space-y-4">
              {[
                ['任务名称', selectedTask.name],
                ['所属模块', selectedTask.module || (selectedTask.type === 'IMPORT' ? '导入' : '导出')],
                ['状态', getStatusText(selectedTask.status)],
                ['进度', `${selectedTask.progress}%`],
                ['开始时间', selectedTask.startTime],
                ['结束时间', selectedTask.endTime || '—'],
                ['结果信息', selectedTask.result || '暂无结果'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-6 border-b border-slate-50 pb-3">
                  <span className="text-xs font-bold text-slate-400 uppercase">{label}</span>
                  <span className="text-sm font-semibold text-slate-700 text-right break-words max-w-[70%]">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
};

export default TaskMonitor;
