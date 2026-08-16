import React, { useEffect, useMemo, useState } from 'react';
import { MainLayout } from '../../../components/Layout/MainLayout';
import { PaginationFooter } from '../../../components/Common/PaginationFooter';
import { useStore } from '../../../store/useStore';
import { canUsePageAction } from '../../../store/role-access';
import { RotateCcw, Trash2, Calendar, User } from 'lucide-react';
import { getItemStatusLabel } from '../../../lib/item-format';
import { paginateRecycleBinItems, RECYCLE_BIN_PAGE_SIZE_OPTIONS } from './recycle-bin-pagination';

const RecycleBin: React.FC = () => {
  const { items, restoreItem, permanentlyDeleteItem, syncItems, searchTerm, currentUser, roles } = useStore();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(RECYCLE_BIN_PAGE_SIZE_OPTIONS[0]);
  const formatDate = (d?: string) => {
    if (!d) return '-';
    const parsed = new Date(d);
    if (!Number.isNaN(parsed.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
    }
    return d.replace(/T.*$/, '');
  };
  const getOriginalStatusLabel = (item: { originalStatus?: string; timeline?: { type: string; content: string }[] }) => {
    if (item.originalStatus) return getItemStatusLabel(item.originalStatus as any);
    const deleteNode = [...(item.timeline || [])].reverse().find(node => node.type === 'STATUS' && node.content.includes('原状态：'));
    const status = deleteNode?.content.match(/原状态：([^；。]+)/)?.[1];
    return status ? getItemStatusLabel(status as any) : '-';
  };
  const isExpired = (deletedAt?: string) => {
    if (!deletedAt) return false;
    return Date.now() - new Date(deletedAt).getTime() > 30 * 24 * 60 * 60 * 1000;
  };

  // 权限与操作范围：
  // - 超级管理员/督办管理员（ADMIN）可操作回收站内全部事项；
  // - 其他角色仅可操作【本人删除】的事项（deletedById === 当前用户）。
  const isRecycleAdmin = currentUser.role === 'ADMIN';
  const canRestore = canUsePageAction(currentUser, roles, 'MENU_RECYCLE_BIN', 'RESTART_ITEM');
  const canDelete = canUsePageAction(currentUser, roles, 'MENU_RECYCLE_BIN', 'DELETE_ITEM');
  const canOperateItem = (item: { deletedById?: string }) =>
    isRecycleAdmin || item.deletedById === currentUser.id;

  useEffect(() => {
    // 回收站必须以明确页面上下文回读服务端软删除事项；普通 syncItems 默认不会返回它们。
    void syncItems('MENU_RECYCLE_BIN');
    return () => {
      // 离开回收站后恢复普通数据视图，避免软删除项停留在其他业务页面的客户端缓存中。
      void syncItems();
    };
  }, [syncItems]);

  useEffect(() => {
    items
      .filter(item => item.status === 'DELETED' && isExpired(item.deletedAt) && canOperateItem(item))
      .forEach(item => permanentlyDeleteItem(item.id, 'MENU_RECYCLE_BIN'));
  }, [items, permanentlyDeleteItem]);

  const deletedItems = items.filter(item => 
    item.status === 'DELETED' &&
    canOperateItem(item) && (
      item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.serialNo.toLowerCase().includes(searchTerm.toLowerCase())
    )
  );
  const pagination = useMemo(
    () => paginateRecycleBinItems(deletedItems, page, pageSize),
    [deletedItems, page, pageSize],
  );

  useEffect(() => {
    if (page !== pagination.currentPage) {
      setPage(pagination.currentPage);
    }
  }, [page, pagination.currentPage]);

  const handleRestore = (id: string) => {
    const item = items.find(i => i.id === id);
    if (item?.deletedById && item.deletedById !== currentUser.id && currentUser.role !== 'ADMIN') {
      alert('仅删除人可恢复该事项');
      return;
    }
    if (confirm('确定要恢复该督办事项吗？')) {
      restoreItem(id, 'MENU_RECYCLE_BIN');
    }
  };

  const handlePermanentDelete = (id: string) => {
    if (confirm('警告：此操作将永久删除该事项及其所有关联数据（附件、日志、动态等），且不可恢复！确定要继续吗？')) {
      permanentlyDeleteItem(id, 'MENU_RECYCLE_BIN');
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">回收站</h1>
          <p className="text-slate-500 text-sm mt-1">管理回收站中的督办事项，支持恢复或永久删除。</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 text-slate-500 text-xs font-bold uppercase tracking-wider">
                <th className="px-6 py-4">督办项信息</th>
                <th className="px-6 py-4">提出会议</th>
                <th className="px-6 py-4">原状态</th>
                <th className="px-6 py-4">负责人</th>
                <th className="px-6 py-4">截止日期</th>
                <th className="px-6 py-4">删除时间</th>
                <th className="px-6 py-4">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {pagination.rows.map((item) => (
                <tr 
                  key={item.id}
                  className="group hover:bg-slate-50/50 transition-colors"
                >
                  <td className="px-6 py-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded uppercase">{item.serialNo}</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-900 line-clamp-1">{item.title}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-slate-600 font-medium">{item.meetingName || item.meetingSource || '-'}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600">
                      {getOriginalStatusLabel(item)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
                        <User className="w-3 h-3 text-slate-500" />
                      </div>
                      <span className="text-sm text-slate-600 font-medium">{item.ownerName}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-slate-500">
                      <Calendar className="w-4 h-4" />
                      <span className="text-sm">{formatDate(item.deadline)}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">{formatDate(item.deletedAt)}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {canRestore && canOperateItem(item) && (
                        <button 
                          onClick={() => handleRestore(item.id)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                          title="恢复"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                      {canDelete && canOperateItem(item) && (
                        <button
                          onClick={() => handlePermanentDelete(item.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          title="永久删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {deletedItems.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <Trash2 className="w-12 h-12 text-slate-200 mb-4" />
                      <p className="text-slate-500 font-medium">暂无已删除的督办事项</p>
                      <p className="text-xs text-slate-400 mt-1">删除后的事项将在此保留30天，期间可随时恢复</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {deletedItems.length > 0 && (
          <PaginationFooter
            totalItems={deletedItems.length}
            currentPage={pagination.currentPage}
            totalPages={pagination.totalPages}
            pageSize={pageSize}
            pageSizeOptions={RECYCLE_BIN_PAGE_SIZE_OPTIONS}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPage(1);
              setPageSize(nextPageSize);
            }}
          />
        )}
      </div>
    </MainLayout>
  );
};

export default RecycleBin;
