import React, { useRef, useState } from 'react';
import { Plus, Download, FileSpreadsheet, CheckCircle2, Send, Zap } from 'lucide-react';
import { useStore } from '../../../store/useStore';
import { CreateItemModal } from '../../../components/Common/CreateItemModal';
import { getActionBarControls } from './action-bar-mode';
import { canUsePageAction } from '../../../store/role-access';
import { getBulkFeedbackItems, getBulkSignableItems } from './action-bar-actions';
import { buildImportTemplateConfig, parseImportFile, rowToCreatePayload } from '../../../lib/batch-import';
import { useToast } from '../../../components/Common/Toast';
import { buildItemExportConfig } from '../../../lib/item-export';
import { downloadCsv, downloadExcel } from '../../../lib/export-csv';
import { formatDate, getEffectiveItemStatus, getItemStatusLabel, getUserSubTaskForIdentity, updateUserSubTaskForIdentity } from '../../../lib/item-format';

export const ActionBar: React.FC = () => {
  const { currentUser, updateItem, items, addActivity, addAsyncTask, addUrgeRecord, syncItems, orgUsers, departments } = useStore();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const { roles } = useStore();
  const { showToast } = useToast();
  const { mode, canSignWorkbench, canFeedbackWorkbench, canExportWorkbench, canCreateItem, canDownloadTemplate, canBatchImport } = getActionBarControls(currentUser, roles);
  // 跟进人工具（催办/亮灯）按 URGE_ITEM 权限独立判定，使其在责任人视图（如督办跟进人兼具责任人身份）下也能保留，避免进入 owner 模式后丢失。
  const canUrgeWorkbench = canUsePageAction(currentUser, roles, 'MENU_WORKBENCH', 'URGE_ITEM');

  const handleImport = () => {
    importFileRef.current?.click();
  };

  const handleImportFile = async (file?: File) => {
    if (!file || file.size === 0) {
      addActivity({
        content: '批量导入失败：请选择非空文件',
        type: 'SYSTEM'
      });
      showToast('请选择非空文件', 'error');
      return;
    }

    if (isImporting) return;
    setIsImporting(true);

    // 创建导入任务
    await addAsyncTask({
      name: `批量导入督办事项：${file.name}`,
      type: 'IMPORT'
    });
    addActivity({
      content: `正在解析文件「${file.name}」...`,
      type: 'SYSTEM'
    });

    try {
      // 1. 解析文件
      const { rows, errors } = await parseImportFile(file);

      // 2. 如果有前端校验错误，报告错误
      if (errors.length > 0) {
        const errorMsgs = errors.slice(0, 10).map(e => e.message).join('\n');
        const suffix = errors.length > 10 ? `\n... 还有 ${errors.length - 10} 个错误` : '';
        showToast(`文件校验发现 ${errors.length} 个错误:\n${errorMsgs}${suffix}`, 'error');
        addActivity({
          content: `批量导入校验失败：${errors.length} 个错误，请修正后重试`,
          type: 'SYSTEM'
        });
        // 标记任务失败
        try {
          const { api } = await import('../../../lib/api');
          const tasks = await api.asyncTasks.list();
          const task = tasks.find((t: any) => t.name.includes(file.name));
          if (task) {
            await api.asyncTasks.update(task.id, { status: 'FAILED', progress: 0 });
          }
        } catch {}
        setIsImporting(false);
        return;
      }

      if (rows.length === 0) {
        showToast('没有有效的数据行可以导入', 'error');
        setIsImporting(false);
        return;
      }

      // 3. 发送到后端批量创建
      showToast(`正在导入 ${rows.length} 条事项...`, 'info');
      addActivity({
        content: `正在处理 ${rows.length} 条事项的批量导入...`,
        type: 'SYSTEM'
      });

      const { api } = await import('../../../lib/api');
      const payload = rows.map(row => ({
        ...rowToCreatePayload(row, { orgUsers, departments }),
        _row: row.rowIndex,
      }));

      const result = await api.items.batchCreate(payload, 'MENU_WORKBENCH');

      // 4. 报告结果
      if (result.failCount > 0) {
        const failDetails = result.results
          .filter(r => !r.success)
          .slice(0, 5)
          .map(r => `第${r.row}行「${r.serialNo}」: ${r.error}`)
          .join('\n');
        const suffix = result.failCount > 5 ? `\n... 还有 ${result.failCount - 5} 条失败` : '';
        showToast(
          `导入完成：成功 ${result.successCount} 条，失败 ${result.failCount} 条\n失败详情:\n${failDetails}${suffix}`,
          result.successCount > 0 ? 'success' : 'error'
        );
      } else {
        showToast(`批量导入完成：成功导入 ${result.successCount} 条督办事项`, 'success');
      }

      addActivity({
        content: `批量导入完成：成功 ${result.successCount} 条，失败 ${result.failCount} 条`,
        type: 'SYSTEM'
      });

      // 5. 同步事项列表
      await syncItems();

      // 6. 标记任务完成
      try {
        const tasks = await api.asyncTasks.list();
        const task = tasks.find((t: any) => t.name.includes(file.name));
        if (task) {
          await api.asyncTasks.update(task.id, {
            status: 'COMPLETED',
            progress: 100,
            result: `成功 ${result.successCount} 条，失败 ${result.failCount} 条`,
          });
        }
      } catch {}

    } catch (err: any) {
      const errorMsg = err?.message || '未知错误';
      showToast(`批量导入失败：${errorMsg}`, 'error');
      addActivity({
        content: `批量导入失败：${errorMsg}`,
        type: 'SYSTEM'
      });
      // 标记任务失败
      try {
        const { api } = await import('../../../lib/api');
        const tasks = await api.asyncTasks.list();
        const task = tasks.find((t: any) => t.name.includes(file.name));
        if (task) {
          await api.asyncTasks.update(task.id, { status: 'FAILED', progress: 0 });
        }
      } catch {}
    } finally {
      setIsImporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    const config = buildImportTemplateConfig();
    downloadCsv(config.filename, config.headers, config.rows);
    addActivity({
      content: `已下载批量导入模板「${config.filename}」`,
      type: 'SYSTEM'
    });
  };

  const handleExport = () => {
    const exportRows = items.filter(item => item.status !== 'DELETED');
    if (exportRows.length === 0) {
      showToast('暂无督办事项可导出', 'info');
      return;
    }

    const config = buildItemExportConfig({
      filenameBase: '督办事项全量导出',
      format: 'excel',
      fieldPreset: 'all',
      rows: exportRows.map(item => ({
        serialNo: item.serialNo,
        title: item.title,
        content: item.content,
        statusLabel: getItemStatusLabel(getEffectiveItemStatus(item)),
        deptNames: item.deptNames,
        ownerName: item.ownerNames?.join('、') || item.ownerName,
        followerName: item.followerNames?.join('、') || item.followerName || '',
        meetingName: item.meetingName || item.meetingSource || '',
        raiseDate: formatDate(item.raiseDate),
        deadline: formatDate(item.deadline),
        requiredCompletionDate: formatDate(item.requiredCompletionDate),
        plannedCompletionDate: formatDate(item.plannedCompletionDate),
        actualCompletionDate: formatDate(item.actualCompletionDate),
      })),
    });
    downloadExcel(config.filename, config.headers, config.rows);
    addActivity({
      content: `已导出全量督办事项 ${exportRows.length} 条`,
      type: 'SYSTEM'
    });
  };

  const handleSignAll = () => {
    const pendingItems = getBulkSignableItems(items, currentUser);
    const skipped: string[] = [];
    pendingItems.forEach(item => {
      // 一键签收时自动带出要求完成日期作为计划完成日期，避免子任务 plannedCompletionDate 为空
      const subTask = getUserSubTaskForIdentity(item, currentUser);
      const hasPlannedDate = subTask?.plannedCompletionDate || item.plannedCompletionDate;
      const fallbackDate = subTask?.requiredCompletionDate || item.requiredCompletionDate || '';
      if (!hasPlannedDate && !fallbackDate) {
        // 既无计划完成日期也无要求完成日期：跳过，需用户手动签收填写
        skipped.push(item.title);
        return;
      }
      const plannedDate = hasPlannedDate || fallbackDate;
      const subTaskUpdates = updateUserSubTaskForIdentity(item, currentUser, {
        status: 'EXECUTING',
        ...(subTask && !subTask.plannedCompletionDate ? { plannedCompletionDate: fallbackDate, deadline: fallbackDate } : {}),
      });
      updateItem(item.id, {
        // 仅在事项仍处于「待签收(PENDING)」时推动为执行中；已延期/已超时等状态保留，不回退生命周期
        status: item.status === 'PENDING' ? (subTaskUpdates.status || 'EXECUTING') : item.status,
        effectiveStatus: item.status === 'PENDING' ? (subTaskUpdates.status || 'EXECUTING') : item.effectiveStatus,
        ...(subTaskUpdates.subTasks ? { subTasks: subTaskUpdates.subTasks } : {}),
        ...(subTask && !subTask.plannedCompletionDate ? { plannedCompletionDate: fallbackDate, deadline: fallbackDate } : {}),
        timeline: [
          ...item.timeline,
          {
            id: 't' + Date.now(),
            type: 'SIGN',
            user: currentUser.name,
            content: `一键签收（计划完成日期：${plannedDate}）`,
            timestamp: new Date().toLocaleString()
          }
        ]
      }, 'MENU_WORKBENCH');
    });

    if (pendingItems.length > 0) {
      addActivity({
        content: `您一键签收了 ${pendingItems.length - skipped.length} 项督办任务${skipped.length > 0 ? `（${skipped.length} 项缺少日期已跳过，请手动签收）` : ''}`,
        type: 'STATUS_CHANGE'
      });
      if (skipped.length > 0 && showToast) {
        showToast(`${skipped.length} 项事项缺少要求完成日期，已跳过，请手动签收填写计划完成日期`, 'warning');
      }
    }
  };

  const handleBulkFeedback = () => {
    const activeItems = getBulkFeedbackItems(items, currentUser);
    if (activeItems.length === 0) return;

    activeItems.forEach(item => {
      updateItem(item.id, {
        timeline: [
          ...item.timeline,
          {
            id: 't' + Date.now(),
            type: 'FEEDBACK',
            user: currentUser.name,
            content: '执行批量反馈：工作正按计划推进中。',
            timestamp: new Date().toLocaleString()
          }
        ],
        progress: Math.min(item.progress + 5, 95)
      }, 'MENU_WORKBENCH');
    });

    addActivity({
      content: `您对 ${activeItems.length} 项任务进行了批量反馈`,
      type: 'FEEDBACK'
    });
  };

  const handleUrgeDelayed = () => {
    const overdueItems = items.filter(i => i.status === 'OVERDUE' || i.status === 'DELAYED');
    if (overdueItems.length === 0) return;

    overdueItems.forEach(item => {
      addUrgeRecord({
        itemId: item.id,
        itemTitle: item.title,
        senderId: currentUser.id,
        sender: currentUser.name,
        receiverId: item.ownerId,
        receiver: item.ownerName,
        status: 'UNREAD',
        method: 'SYSTEM',
        content: '请尽快反馈超期事项进展。'
      });
    });

    addActivity({
      content: `系统已对 ${overdueItems.length} 项超期任务发起自动催办`,
      type: 'URGE'
    });
  };

  const handleLightManagement = () => {
    addActivity({
      content: '正在执行全院督办亮灯逻辑重算...',
      type: 'SYSTEM'
    });
    setTimeout(() => {
      addActivity({
        content: '亮灯状态更新完成：新增红灯 1 个，黄灯 2 个',
        type: 'SYSTEM'
      });
    }, 1000);
  };

  // 操作类按钮（一键签收全部/批量反馈/一键催办超期/亮灯管理）仅对「责任人(OWNER)」视图显示。
  // 以 mode（owner 模式，由 SIGN_ITEM/FEEDBACK_ITEM 权限推导）判定，而非全局 roleId 映射，
  // 以免双重身份用户（如同时是跟进人 r2 与责任人）被错判为 FOLLOWER 而丢失责任人视图下的操作按钮。
  const renderRoleButtons = () => {
    if (mode !== 'owner') return null;
    return (
      <>
        {canSignWorkbench && (
          <button
            onClick={handleSignAll}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-all shadow-sm active:scale-95"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>一键签收全部</span>
          </button>
        )}
        {canFeedbackWorkbench && (
          <button
            onClick={handleBulkFeedback}
            className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-semibold hover:bg-slate-50 transition-all active:scale-95"
          >
            <Send className="w-4 h-4" />
            <span>批量反馈</span>
          </button>
        )}
        {canUrgeWorkbench && (
          <button
            onClick={handleUrgeDelayed}
            className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-red-700 transition-all shadow-sm active:scale-95"
          >
            <Zap className="w-4 h-4" />
            <span>一键催办超期</span>
          </button>
        )}
        {canUrgeWorkbench && (
          <button
            onClick={handleLightManagement}
            className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-semibold hover:bg-slate-50 transition-all active:scale-95"
          >
            <Zap className="w-4 h-4" />
            <span>亮灯管理</span>
          </button>
        )}
      </>
    );
  };

  return (
    <div className="flex items-center justify-between mb-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">工作台</h1>
        <p className="text-slate-500 text-sm mt-1">欢迎回来，{currentUser.name}。这是您今天的任务概览。</p>
      </div>
      <div className="flex items-center gap-3">
        {canCreateItem && (
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-all shadow-sm active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>发起督办</span>
          </button>
        )}
        {canBatchImport && (
          <button
            onClick={handleImport}
            disabled={isImporting}
            className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-semibold hover:bg-slate-50 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{isImporting ? '导入中...' : '批量导入'}</span>
          </button>
        )}
        {canDownloadTemplate && (
          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-semibold hover:bg-slate-50 transition-all active:scale-95"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>导入模板</span>
          </button>
        )}
        {canExportWorkbench && (
          <button
            onClick={handleExport}
            className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-semibold hover:bg-slate-50 transition-all active:scale-95"
          >
            <Download className="w-4 h-4" />
            <span>全量导出</span>
          </button>
        )}
        {renderRoleButtons()}
      </div>
      <input
        ref={importFileRef}
        type="file"
        accept=".csv,.xlsx"
        className="hidden"
        onChange={(event) => {
          handleImportFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      <CreateItemModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        pageAuth="MENU_WORKBENCH"
      />
    </div>
  );
};
