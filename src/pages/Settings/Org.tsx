import React, { useState, useEffect, useMemo } from 'react';
import { MainLayout } from '../../components/Layout/MainLayout';
import { PaginationFooter } from '../../components/Common/PaginationFooter';
import { useStore } from '../../store/useStore';
import { useToast } from '../../components/Common/Toast';
import { hasAuthToken, api } from '../../lib/api';
import { DEFAULT_PAGE_SIZE_OPTIONS, paginateItems } from '../../components/Common/pagination';
import { 
  Users, 
  ChevronRight, 
  ChevronDown, 
  Plus, 
  Search, 
  MoreVertical, 
  UserPlus,
  Building2,
  Mail,
  Phone,
  ShieldCheck,
  Edit2,
  Trash2,
  GripVertical,
  RefreshCw,
  AlertTriangle,
  Upload,
  Download
} from 'lucide-react';

import { DeptNode } from '../../types';
import { Drawer } from '../../components/Common/Drawer';
import { downloadCsv } from '../../lib/export-csv';
import { getRolesByUser } from '../../store/role-access';

// 可搜索下拉框组件
const SearchableSelect: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  emptyText?: string;
}> = ({ value, onChange, options, placeholder, emptyText }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = React.useRef<HTMLDivElement>(null);

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase())
  );

  const selectedOption = options.find(o => o.value === value);
  const isUnknownDept = value && !selectedOption;
  const selectedLabel = selectedOption?.label || '';

  // 点击外部关闭
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div
        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white cursor-pointer flex items-center justify-between gap-2"
        onClick={() => { setIsOpen(!isOpen); setSearch(''); }}
      >
        <span className={`text-sm truncate flex items-center gap-2 ${value ? (isUnknownDept ? 'text-amber-700' : 'text-slate-900') : 'text-slate-400'}`}>
          {isUnknownDept ? (
            <>
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <span>未知部门 (ID: {value.slice(0, 8)}...)</span>
            </>
          ) : (value ? selectedLabel : placeholder)}
        </span>
        <svg className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </div>
      {isOpen && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              placeholder="搜索姓名..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-400 text-center">{emptyText || '无匹配结果'}</div>
            ) : (
              filtered.map(o => (
                <div
                  key={o.value}
                  className={`px-4 py-2.5 text-sm cursor-pointer flex items-center justify-between hover:bg-blue-50 transition-colors ${o.value === value ? 'bg-blue-50 text-blue-600 font-medium' : 'text-slate-700'}`}
                  onClick={() => { onChange(o.value); setIsOpen(false); }}
                >
                  <span>{o.label}</span>
                  {o.value === value && <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const OrgManagement: React.FC = () => {
  const { departments, orgUsers, roles, addDepartment, updateDepartment, deleteDepartment, addOrgUser, batchAddOrgUsers, updateOrgUser, deleteOrgUser, addLog, addAsyncTask, currentUser, syncDepartments } = useStore();
  const { showToast } = useToast();
  const tableBodyRef = React.useRef<HTMLTableSectionElement>(null);
  const [selectedDeptId, setSelectedDeptId] = useState<string>('root');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['root', 'd1']));
  const [isDragging, setIsDragging] = useState<string | null>(null);
  const [isDeptDrawerOpen, setIsDeptDrawerOpen] = useState(false);
  const [isEditDeptDrawerOpen, setIsEditDeptDrawerOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<{ id: string; name: string } | null>(null);
  const [isUserDrawerOpen, setIsUserDrawerOpen] = useState(false);
  const [isEditUserDrawerOpen, setIsEditUserDrawerOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<{ id: string; name: string; username: string; deptId?: string; roleId: string; roleIds: string[]; role: string; email: string; phone: string; status: string; supervisorId?: string; adminOrgIds: string[] } | null>(null);
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptType, setNewDeptType] = useState<string>('DEPARTMENT');
  const [newDeptParentId, setNewDeptParentId] = useState<string>('root');
  const [newUser, setNewUser] = useState({ name: '', username: '', roleId: '', role: '普通员工', email: '', phone: '', supervisorId: '' });
  const [isBatchImportOpen, setIsBatchImportOpen] = useState(false);
  const [batchImportText, setBatchImportText] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  // 与后端 canManageUsers 口径一致：需 MENU_ORG/MENU_SYSTEM 菜单权限，且具备 EDIT_SYSTEM 动作。
  // 此前仅判断登录态，导致无权限角色看到可用按钮、提交被 403 拒绝却提示成功。
  const canManageMembers = useMemo(() => {
    if (!hasAuthToken()) return false;
    return getRolesByUser(currentUser, roles).some((role) => {
      const authCodes = role.authCodes || [];
      if (!authCodes.includes('ALL') && !authCodes.includes('MENU_ORG') && !authCodes.includes('MENU_SYSTEM')) return false;
      if (authCodes.includes('ALL')) return true;
      return (role.allowedActions || []).includes('EDIT_SYSTEM');
    });
  }, [currentUser, roles]);
  const handleSyncContacts = async () => {
    await addAsyncTask({
      name: '企业微信通讯录全量同步',
      type: 'IMPORT',
    });
    addLog({ userName: currentUser.name, userId: currentUser.id, action: '发起企业微信通讯录全量同步', module: '组织架构' });
    showToast('通讯录全量同步任务已提交，请前往任务监控查看进度', 'info');
  };

  const handleExportOrg = () => {
    downloadCsv(
      `组织与账号_${new Date().toISOString().split('T')[0]}.csv`,
      ['姓名', '账号', '部门ID', '角色', '邮箱', '电话', '状态'],
      orgUsers.map((user) => [
        user.name,
        user.username,
        user.deptId || '',
        user.role,
        user.email || '',
        user.phone || '',
        user.status,
      ]),
    );
    addLog({ userName: currentUser.name, userId: currentUser.id, action: '导出组织与账号数据', module: '组织架构' });
  };

  // 页面挂载时从服务端同步最新的部门数据
  useEffect(() => {
    if (hasAuthToken()) {
      syncDepartments();
    }
  }, [syncDepartments]);

  // 分页
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE_OPTIONS[0]);

  // 根据 ID 查找部门名称
  const findDeptName = (id: string | undefined, nodes?: DeptNode[]): string => {
    if (!id || id === '__TOP__') return '（顶级，与集团总部同级）';
    const searchNodes = nodes || departments;
    for (const node of searchNodes) {
      if (node.id === id) return node.name;
      if (node.children) {
        const found = findDeptName(id, node.children);
        // 递归返回的结果必须与 id 不同（即找到了真实名称），
        // 而非 fallback 返回的原始 id，避免提前终止遍历同级节点
        if (found && found !== id) return found;
      }
    }
    return id;
  };

  // 展开部门树为扁平列表
  const flattenDepts = (nodes?: DeptNode[], prefix?: string): { value: string; label: string }[] => {
    const result: { value: string; label: string }[] = [];
    const list = nodes || departments;
    for (const node of list) {
      result.push({ value: node.id, label: prefix ? `${prefix} / ${node.name}` : node.name });
      if (node.children) {
        result.push(...flattenDepts(node.children, prefix ? `${prefix} / ${node.name}` : node.name));
      }
    }
    return result;
  };

  const filteredUsers = orgUsers.filter(u => {
    // 按选中部门筛选
    if (selectedDeptId !== 'root' && u.deptId !== selectedDeptId) return false;
    // 按关键字搜索（成员姓名、部门名称）
    if (searchKeyword.trim()) {
      const kw = searchKeyword.trim().toLowerCase();
      const deptName = u.deptId ? findDeptName(u.deptId).toLowerCase() : '';
      return u.name.toLowerCase().includes(kw) || deptName.includes(kw);
    }
    return true;
  });

  // 检查部门下是否有员工
  const hasMembers = (deptId: string): boolean => {
    return orgUsers.some(u => u.deptId === deptId);
  };

  // 分页计算
  const pagination = useMemo(
    () => paginateItems(filteredUsers, currentPage, pageSize),
    [currentPage, filteredUsers, pageSize],
  );

  // 切换分页时重置 currentPage
  useEffect(() => {
    if (currentPage !== pagination.currentPage) setCurrentPage(pagination.currentPage);
  }, [currentPage, pagination.currentPage]);

  const handleBatchImport = async () => {
    if (!batchImportText.trim()) {
      showToast('请先输入成员数据', 'warning');
      return;
    }
    // 每行一条：姓名,登录账号,角色,邮箱,手机  （登录账号必填，角色可选，邮箱手机可选）
    const lines = batchImportText.trim().split('\n').filter(l => l.trim());
    const users: { name: string; username: string; role?: string; email?: string; phone?: string }[] = [];
    const errors: string[] = [];
    lines.forEach((line, i) => {
      const parts = line.split(',').map(p => p.trim());
      if (!parts[0]) { errors.push(`第${i+1}行缺少姓名`); return; }
      if (!parts[1]) { errors.push(`第${i+1}行缺少登录账号`); return; }
      users.push({
        name: parts[0],
        username: parts[1],
        role: parts[2] || '普通员工',
        email: parts[3] || '',
        phone: parts[4] || '',
      });
    });
    if (users.length === 0) {
      showToast('没有有效的成员数据', 'warning');
      return;
    }
    try {
      await batchAddOrgUsers(selectedDeptId, users);
    } catch (e: any) {
      showToast(`批量导入失败：${e?.message || '请稍后重试'}`, 'error');
      return;
    }
    addLog({
      userName: currentUser.name,
      userId: currentUser.id,
      action: `批量导入成员: 共 ${users.length} 人`,
      module: '组织架构',
    });
    showToast(`成功导入 ${users.length} 名成员${errors.length ? `，${errors.length} 条跳过` : ''}`, 'success');
    setBatchImportText('');
    setIsBatchImportOpen(false);
  };

  // 检查同级部门下是否有同名
  const hasDuplicateDeptName = (parentId: string, name: string, nodes: DeptNode[] = departments): boolean => {
    const siblings = parentId === '__TOP__' ? nodes : (() => {
      const findParent = (list: DeptNode[]): DeptNode[] | null => {
        for (const n of list) {
          if (n.id === parentId) return n.children || [];
          if (n.children) {
            const found = findParent(n.children);
            if (found) return found;
          }
        }
        return null;
      };
      return findParent(nodes) || [];
    })();
    return siblings.some(s => s.name === name);
  };

  const handleAddDept = async () => {
    if (!newDeptName.trim()) return;
    if (hasDuplicateDeptName(newDeptParentId, newDeptName.trim())) {
      showToast(`同级部门已存在同名「${newDeptName.trim()}」，请修改名称`, 'warning');
      return;
    }
    try {
      await addDepartment(newDeptParentId, newDeptName.trim(), newDeptType);
      showToast(`部门「${newDeptName.trim()}」已创建`, 'success');
      addLog({
        userName: currentUser.name,
        userId: currentUser.id,
        action: `新增部门: ${newDeptName} (${newDeptType})`,
        module: '组织架构'
      });
      setNewDeptName('');
      setNewDeptType('DEPARTMENT');
      setIsDeptDrawerOpen(false);
    } catch (e: any) {
      showToast(`新增部门失败：${e?.message || '未知错误'}`, 'error');
    }
  };

  const handleAddUser = async () => {
    if (!newUser.name.trim()) return;
    if (!newUser.username.trim()) {
      showToast('请填写登录账号', 'warning');
      return;
    }
    if (!newUser.roleId) {
      showToast('请选择系统角色', 'warning');
      return;
    }
    const memberName = newUser.name;
    try {
      await addOrgUser(selectedDeptId, newUser);
    } catch (e: any) {
      showToast(`添加成员失败：${e?.message || '请稍后重试'}`, 'error');
      return;
    }
    showToast(`已添加成员 ${memberName}`, 'success');
    addLog({
      userName: currentUser.name,
      userId: currentUser.id,
      action: `添加成员: ${memberName}`,
      module: '组织架构'
    });
    setNewUser({ name: '', username: '', roleId: '', role: '普通员工', email: '', phone: '', supervisorId: '' });
    setIsUserDrawerOpen(false);
  };

  const handleDeleteUser = async (id: string, name: string) => {
    if (window.confirm(`确定要移除成员【${name}】吗？`)) {
      if (!hasAuthToken()) {
        showToast('当前为离线登录状态，无法删除成员。请重新登录后重试', 'warning');
        return;
      }

      try {
        await deleteOrgUser(id);
        showToast(`已移除成员 ${name}`, 'success');
        addLog({
          userName: currentUser.name,
          userId: currentUser.id,
          action: `移除成员: ${name}`,
          module: '组织架构'
        });
      } catch (error) {
        console.warn('删除成员失败:', error);
        showToast(`移除成员 ${name} 失败，请稍后重试`, 'warning');
      }
    }
  };

  // 事件委托：在 tbody 上统一处理 edit/delete 按钮点击，避免 motion.tr 等动画组件拦截 React 合成事件
  useEffect(() => {
    const tbody = tableBodyRef.current;
    if (!tbody) return;
    const handler = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!target) return;
      // edit
      if (target.dataset.action === 'edit') {
        const userId = target.dataset.userid!;
        const u = orgUsers.find(o => o.id === userId);
        if (u) {
          handleEditUser({ id: u.id, name: u.name, username: u.username, deptId: u.deptId, roleId: u.roleId || '', roleIds: u.roleIds, role: u.role, email: u.email, phone: u.phone, status: u.status, supervisorId: u.supervisorId, adminOrgIds: u.adminOrgIds });
        }
        return;
      }
      // delete
      if (target.dataset.action === 'delete') {
        void handleDeleteUser(target.dataset.userid!, target.dataset.username!);
        return;
      }
    };
    tbody.addEventListener('click', handler);
    return () => tbody.removeEventListener('click', handler);
  }, [orgUsers, roles]);

  const handleEditUser = (user: { id: string; name: string; username: string; deptId?: string; roleId: string; roleIds?: string[]; role: string; email: string; phone: string; status: string; supervisorId?: string; adminOrgIds?: string[] }) => {
    setEditingUser({ ...user, roleIds: user.roleIds || [], adminOrgIds: user.adminOrgIds || [] });
    setIsEditUserDrawerOpen(true);
  };

  const handleSaveEditUser = async () => {
    if (!editingUser || !editingUser.name.trim()) return;
    const memberName = editingUser.name;
    try {
      await updateOrgUser(editingUser.id, {
        name: editingUser.name,
        username: editingUser.username,
        deptId: editingUser.deptId,
        roleId: editingUser.roleId,
        roleIds: editingUser.roleIds.length > 0 ? editingUser.roleIds : undefined,
        role: editingUser.role,
        email: editingUser.email,
        phone: editingUser.phone,
        supervisorId: editingUser.supervisorId || undefined,
        adminOrgIds: editingUser.adminOrgIds.length > 0 ? editingUser.adminOrgIds : [],
      } as any);
    } catch (e: any) {
      showToast(`成员 ${memberName} 信息保存失败：${e?.message || '请稍后重试'}`, 'error');
      return;
    }
    showToast(`成员 ${memberName} 信息已更新`, 'success');
    addLog({
      userName: currentUser.name,
      userId: currentUser.id,
      action: `编辑成员: ${memberName}`,
      module: '组织架构'
    });
    setIsEditUserDrawerOpen(false);
    setEditingUser(null);
  };

  const handleEditDept = (id: string, name: string) => {
    if (hasMembers(id)) {
      return showToast(`部门【${name}】下有员工，不可编辑`, 'warning');
    }
    setEditingDept({ id, name });
    setIsEditDeptDrawerOpen(true);
  };

  const handleUpdateDept = async () => {
    if (!editingDept || !editingDept.name.trim()) return;
    try {
      await updateDepartment(editingDept.id, editingDept.name.trim());
      showToast(`部门已重命名为 ${editingDept.name}`, 'success');
      addLog({
        userName: currentUser.name,
        userId: currentUser.id,
        action: `编辑部门: ${editingDept.name}`,
        module: '组织架构'
      });
      setIsEditDeptDrawerOpen(false);
      setEditingDept(null);
    } catch (e: any) {
      showToast(`修改部门失败：${e?.message || '未知错误'}`, 'error');
    }
  };

  const handleDeleteDept = async (id: string, name: string) => {
    if (id === 'root') return showToast('根节点不可删除', 'warning');
    if (hasMembers(id)) {
      return showToast(`部门【${name}】下有员工，不可删除`, 'warning');
    }
    if (confirm(`确定要删除部门【${name}】吗？`)) {
      try {
        await deleteDepartment(id);
        setSelectedDeptId('root');
        showToast(`部门【${name}】已删除`, 'success');
        addLog({
          userName: currentUser.name,
          userId: currentUser.id,
          action: `删除部门: ${name}`,
          module: '组织架构'
        });
      } catch (e: any) {
        showToast(`删除失败：${e?.message || '未知错误'}`, 'error');
      }
    }
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setIsDragging(id);
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('text/plain');
    if (sourceId === targetId) return;
    
    addLog({
      userName: currentUser.name,
      userId: currentUser.id,
      action: `调整部门排序: ${sourceId} -> ${targetId}`,
      module: '组织架构'
    });
    showToast('部门排序已更新', 'success');
    setIsDragging(null);
  };

  const toggleNode = (id: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedNodes(newExpanded);
  };

  const renderDeptTree = (nodes: DeptNode[], level: number = 0) => {
    const sorted = [...nodes].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    return sorted.map(node => (
      <div key={node.id} className="select-none">
        <div 
          draggable
          onDragStart={(e) => handleDragStart(e, node.id)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, node.id)}
          onClick={() => {
            if (node.children) toggleNode(node.id);
            setSelectedDeptId(node.id);
          }}
          className={`
            group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all mb-0.5 relative
            ${selectedDeptId === node.id ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}
            ${isDragging === node.id ? 'opacity-40 scale-95' : ''}
          `}
          style={{ paddingLeft: `${level * 1.5 + 0.75}rem` }}
        >
          <GripVertical className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity" />
          {node.children ? (
            expandedNodes.has(node.id) ? 
              <ChevronDown className="w-4 h-4 text-slate-400" /> : 
              <ChevronRight className="w-4 h-4 text-slate-400" />
          ) : (
            <div className="w-4" />
          )}
          <Building2 className={`w-4 h-4 ${selectedDeptId === node.id ? 'text-blue-500' : 'text-slate-400'}`} />
          <span className="text-sm font-semibold truncate max-w-[200px]" title={node.name}>{node.name}</span>
          {node.type && node.type !== 'GROUP' && (
            <span className="text-[9px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{node.type === 'COMPANY' ? '公司' : node.type === 'DEPARTMENT' ? '部门' : '科室'}</span>
          )}
          {/* 操作按钮：根节点不显示编辑/删除 */}
          {node.id !== 'root' && (
            <div className="ml-auto flex items-center gap-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); handleEditDept(node.id, node.name); }}
                className="p-1 text-blue-500 hover:bg-blue-50 rounded"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteDept(node.id, node.name); }}
                className="p-1 text-red-500 hover:bg-red-50 rounded"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        
        {node.children && expandedNodes.has(node.id) && (
          <div className="mt-0.5">{renderDeptTree(node.children, level + 1)}</div>
        )}
      </div>
    ));
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">组织架构管理</h1>
          <p className="text-slate-500 text-sm mt-1">维护医院组织层级，管理部门人员及其系统角色权限。</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="搜索成员姓名或部门..."
              className="w-56 bg-white border border-slate-200 rounded-lg py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={searchKeyword}
              onChange={(e) => { setSearchKeyword(e.target.value); setCurrentPage(1); }}
            />
          </div>
          <button 
            onClick={handleSyncContacts}
            className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-semibold hover:bg-slate-50 transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            <span>通讯录同步</span>
          </button>
          <button 
            onClick={handleExportOrg}
            className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-semibold hover:bg-slate-50 transition-all"
          >
            <Download className="w-4 h-4" />
            <span>导出组织</span>
          </button>
          <button 
            onClick={() => { setNewDeptParentId('__TOP__'); setIsDeptDrawerOpen(true); }}
            className="hidden"
          >
            <Plus className="w-4 h-4" />
            <span>新增部门</span>
          </button>
        </div>
      </div>

      <div className="flex gap-6 h-[calc(100vh-200px)]">
        {/* Left: Dept Tree */}
        <div className="w-[404px] bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-50 bg-slate-50/30">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">组织树</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {renderDeptTree(departments)}
          </div>
        </div>

        {/* Right: Member List */}
        <div className="flex-1 bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col overflow-hidden">
          <div className="p-6 border-b border-slate-50 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0 mt-0.5">
                <Building2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-slate-900">
                  {selectedDeptId === 'root' ? '全集团成员' : '部门成员管理'}
                </h3>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider break-all">当前选中: {findDeptName(selectedDeptId)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={() => { if (canManageMembers) { setNewDeptParentId(selectedDeptId); setIsDeptDrawerOpen(true); } }}
                disabled={!canManageMembers}
                className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-semibold hover:bg-slate-50 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                <span>新增部门</span>
              </button>
              <button 
                onClick={() => { if (canManageMembers) setIsUserDrawerOpen(true); }}
                disabled={!canManageMembers}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <UserPlus className="w-4 h-4" />
                <span>添加成员</span>
              </button>
              <button 
                onClick={() => { if (canManageMembers) setIsBatchImportOpen(true); }}
                disabled={!canManageMembers}
                className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-semibold hover:bg-slate-50 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Upload className="w-4 h-4" />
                <span>批量导入</span>
              </button>
            </div>
          </div>
          {!canManageMembers && (
            <div className="mx-6 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {!hasAuthToken()
                ? '当前处于离线登录状态，仅可查看成员信息，新增、编辑、删除、导入等操作已禁用。请重新登录后再执行成员管理操作。'
                : '当前账号无成员管理权限（需具备组织/系统菜单权限及「编辑系统配置」动作），仅可查看成员信息。如需管理成员，请联系管理员调整角色权限。'}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            <table className="w-full table-fixed text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 text-slate-500 text-[10px] font-bold uppercase tracking-wider border-b border-slate-50">
                  <th className="w-[16%] px-4 py-3 whitespace-nowrap">姓名</th>
                  <th className="w-[14%] px-4 py-3 whitespace-nowrap">登录账号</th>
                  <th className="w-[28%] px-4 py-3 whitespace-nowrap">系统角色</th>
                  <th className="w-[16%] px-4 py-3 whitespace-nowrap">直属上级</th>
                  <th className="w-[10%] px-4 py-3 whitespace-nowrap">状态</th>
                  <th className="w-[16%] px-4 py-3 text-right whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody ref={tableBodyRef} className="divide-y divide-slate-50">
                {pagination.rows.map((user) => (
                  <tr
                    key={user.id}
                    className="group hover:bg-slate-50/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs shrink-0">
                          {user.name[0]}
                        </div>
                        <span className="truncate text-sm font-bold text-slate-700">{user.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block truncate text-xs font-medium text-slate-500">{user.username || '-'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(user.roleIds && user.roleIds.length > 0
                          ? user.roleIds.map(rid => {
                              const r = roles.find(ro => ro.id === rid);
                              return r ? (
                                <span key={rid} className="text-xs font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md">
                                  {r.name}
                                </span>
                              ) : null;
                            })
                          : [<span key={user.role} className="text-xs font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md">{user.role}</span>]
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {user.supervisorId ? (
                        <span className="block truncate text-xs font-medium text-slate-500">
                          {orgUsers.find(u => u.id === user.supervisorId)?.name || '-'}
                        </span>
                      ) : (
                        <span className="block truncate text-xs text-slate-300 italic">未设置</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <div className={`w-1.5 h-1.5 rounded-full ${user.status === 'ACTIVE' ? 'bg-green-500' : 'bg-slate-300'}`} />
                        <span className="text-xs font-bold text-slate-600">{user.status === 'ACTIVE' ? '在职' : '离职'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button 
                          data-action="edit"
                          data-userid={user.id}
                          disabled={!canManageMembers}
                          className="p-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Edit2 className="w-4 h-4 pointer-events-none" />
                        </button>
                        <button 
                          data-action="delete"
                          data-userid={user.id}
                          data-username={user.name}
                          disabled={!canManageMembers}
                          className="p-1.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-4 h-4 pointer-events-none" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* 分页 */}
            {filteredUsers.length > 0 && (
              <PaginationFooter
                totalItems={filteredUsers.length}
                currentPage={pagination.currentPage}
                totalPages={pagination.totalPages}
                pageSize={pageSize}
                pageSizeOptions={DEFAULT_PAGE_SIZE_OPTIONS}
                itemLabel="成员"
                onPageChange={setCurrentPage}
                onPageSizeChange={(nextPageSize) => {
                  setCurrentPage(1);
                  setPageSize(nextPageSize);
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Dept Drawer */}
      <Drawer
        isOpen={isDeptDrawerOpen}
        onClose={() => setIsDeptDrawerOpen(false)}
        title="新增部门"
        footer={
          <div className="flex gap-3 justify-end">
            <button onClick={() => setIsDeptDrawerOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
            <button onClick={handleAddDept} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all">确定新增</button>
          </div>
        }
      >
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">上级组织</label>
            <p className="px-4 py-2 bg-slate-50 border border-slate-100 rounded-lg text-sm font-bold text-slate-500">{findDeptName(newDeptParentId)}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">公司/部门名称</label>
            <input 
              type="text"
              placeholder="请输入公司/部门名称"
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">所属类型</label>
            <select
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={newDeptType}
              onChange={(e) => setNewDeptType(e.target.value)}
            >
              <option value="DEPARTMENT">部门</option>
              <option value="COMPANY">公司</option>
              <option value="OFFICE">科室</option>
            </select>
          </div>
        </div>
      </Drawer>

      {/* User Drawer */}
      <Drawer
        isOpen={isUserDrawerOpen}
        onClose={() => setIsUserDrawerOpen(false)}
        title="添加部门成员"
        footer={
          <div className="flex gap-3 justify-end">
            <button onClick={() => setIsUserDrawerOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
            <button onClick={handleAddUser} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all">确定添加</button>
          </div>
        }
      >
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">成员姓名</label>
            <input 
              type="text"
              placeholder="请输入姓名"
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={newUser.name}
              onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">登录账号</label>
            <input 
              type="text"
              placeholder="请输入登录账号"
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={newUser.username}
              onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">系统角色 <span className="text-xs text-slate-400 font-normal">（角色数据权限在「系统设置 → 角色权限」中配置）</span></label>
            <select 
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={newUser.roleId}
              onChange={(e) => {
                const selectedRole = roles.find(r => r.id === e.target.value);
                if (selectedRole) {
                  setNewUser({ ...newUser, roleId: selectedRole.id, role: selectedRole.name });
                }
              }}
            >
              <option value="">-- 请选择角色 --</option>
              {roles.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">直属上级 <span className="text-xs text-slate-400 font-normal">（跨部门/跨公司的虚线汇报关系，选填）</span></label>
            <SearchableSelect
              value={newUser.supervisorId || ''}
              onChange={(v) => setNewUser({ ...newUser, supervisorId: v })}
              options={[
                { value: '', label: '-- 无（不设直属上级） --' },
                ...orgUsers.filter(u => u.status === 'ACTIVE').map(u => ({
                  value: u.id,
                  label: `${u.name}${u.deptId ? `（${findDeptName(u.deptId)}）` : ''}`
                }))
              ]}
              placeholder="搜索并选择直属上级..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">电子邮箱</label>
              <input 
                type="email"
                placeholder="xxx@hospital.com"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">手机号码</label>
              <input 
                type="tel"
                placeholder="138xxxxxxxx"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                value={newUser.phone}
                onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
              />
            </div>
          </div>
        </div>
      </Drawer>

      {/* Edit User Drawer */}
      <Drawer
        isOpen={isEditUserDrawerOpen}
        onClose={() => { setIsEditUserDrawerOpen(false); setEditingUser(null); }}
        title="编辑成员信息"
        footer={
          <div className="flex gap-3 justify-end">
            <button onClick={() => { setIsEditUserDrawerOpen(false); setEditingUser(null); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
            <button onClick={handleSaveEditUser} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all">保存修改</button>
          </div>
        }
      >
        {editingUser && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">成员姓名</label>
              <input 
                type="text"
                placeholder="请输入姓名"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                value={editingUser.name}
                onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">登录账号</label>
              <input 
                type="text"
                placeholder="请输入登录账号"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                value={editingUser.username}
                onChange={(e) => setEditingUser({ ...editingUser, username: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">所属部门</label>
              <SearchableSelect
                value={editingUser.deptId || ''}
                onChange={(v) => setEditingUser({ ...editingUser, deptId: v || undefined })}
                options={[
                  { value: '', label: '-- 请选择部门 --' },
                  ...flattenDepts()
                ]}
                placeholder="搜索并选择所属部门..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">系统角色 <span className="text-xs text-slate-400 font-normal">（可选择多个角色，权限取并集）</span></label>
              <div className="border border-slate-200 rounded-lg p-3 space-y-1 max-h-48 overflow-y-auto">
                {roles.map(r => {
                  const checked = editingUser.roleIds.includes(r.id) || editingUser.roleId === r.id;
                  return (
                    <label key={r.id} className="flex items-center gap-2.5 p-1.5 rounded hover:bg-blue-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const newRoleIds = editingUser.roleIds.includes(r.id)
                            ? editingUser.roleIds.filter(id => id !== r.id)
                            : [...editingUser.roleIds, r.id];
                          // 保持 roleId 为第一个角色（向后兼容）
                          const primaryRoleId = newRoleIds.length > 0 ? newRoleIds[0] : '';
                          const primaryRole = roles.find(ro => ro.id === primaryRoleId);
                          setEditingUser({
                            ...editingUser,
                            roleIds: newRoleIds,
                            roleId: primaryRoleId,
                            role: primaryRole?.name || '',
                          });
                        }}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-slate-700">{r.name}</span>
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-slate-400 mt-1">勾选后用户自动获得所选角色的全部权限和数据范围</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">直属上级 <span className="text-xs text-slate-400 font-normal">（跨部门/跨公司的虚线汇报关系，选填）</span></label>
              <SearchableSelect
                value={editingUser.supervisorId || ''}
                onChange={(v) => setEditingUser({ ...editingUser, supervisorId: v || undefined })}
                options={[
                  { value: '', label: '-- 无（不设直属上级） --' },
                  ...orgUsers.filter(u => u.status === 'ACTIVE' && u.id !== editingUser.id).map(u => ({
                    value: u.id,
                    label: `${u.name}${u.deptId ? `（${findDeptName(u.deptId)}）` : ''}`
                  }))
                ]}
                placeholder="搜索并选择直属上级..."
              />
            </div>
            {/* P0-1&2: 授权组织多选 — 仅当角色数据范围为 MULTI_ORG 或 SELF_AND_DIRECT_SUBORDINATES 时有用 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">授权组织 <span className="text-xs text-slate-400 font-normal">（跨组织数据范围，仅对 MULTI_ORG / SELF_AND_DIRECT_SUBORDINATES 角色生效）</span></label>
              <div className="border border-slate-200 rounded-lg p-3 space-y-1 max-h-48 overflow-y-auto">
                {departments[0]?.children?.map(org => (
                  <label key={org.id} className="flex items-center gap-2.5 p-1.5 rounded hover:bg-indigo-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingUser.adminOrgIds.includes(org.id)}
                      onChange={() => {
                        const next = editingUser.adminOrgIds.includes(org.id)
                          ? editingUser.adminOrgIds.filter(id => id !== org.id)
                          : [...editingUser.adminOrgIds, org.id];
                        setEditingUser({ ...editingUser, adminOrgIds: next });
                      }}
                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                    />
                    <span className="text-sm font-medium text-slate-700">{org.name}</span>
                    <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{org.type === 'COMPANY' ? '公司' : '部门'}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-1">选中的组织将用于 MULTI_ORG 和 SELF_AND_DIRECT_SUBORDINATES 数据范围的组织交叉校验</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">电子邮箱</label>
                <input 
                  type="email"
                  placeholder="xxx@hospital.com"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  value={editingUser.email}
                  onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">手机号码</label>
                <input 
                  type="tel"
                  placeholder="138xxxxxxxx"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  value={editingUser.phone}
                  onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">状态</label>
              <select 
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                value={editingUser.status}
                onChange={(e) => setEditingUser({ ...editingUser, status: e.target.value })}
              >
                <option value="ACTIVE">在职</option>
                <option value="INACTIVE">离职</option>
              </select>
            </div>
          </div>
        )}
      </Drawer>

      {/* Edit Dept Drawer */}
      <Drawer
        isOpen={isEditDeptDrawerOpen}
        onClose={() => { setIsEditDeptDrawerOpen(false); setEditingDept(null); }}
        title="编辑部门"
        footer={
          <div className="flex gap-3 justify-end">
            <button onClick={() => { setIsEditDeptDrawerOpen(false); setEditingDept(null); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
            <button onClick={handleUpdateDept} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all">保存修改</button>
          </div>
        }
      >
        {editingDept && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">部门名称</label>
              <input 
                type="text"
                placeholder="请输入部门名称"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                value={editingDept.name}
                onChange={(e) => setEditingDept({ ...editingDept, name: e.target.value })}
              />
            </div>
          </div>
        )}
      </Drawer>

      {/* Batch Import Drawer */}
      <Drawer
        isOpen={isBatchImportOpen}
        onClose={() => { setIsBatchImportOpen(false); setBatchImportText(''); }}
        title="批量导入成员"
        footer={
          <div className="flex gap-3 justify-end">
            <button onClick={() => { setIsBatchImportOpen(false); setBatchImportText(''); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
            <button onClick={handleBatchImport} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all">确认导入</button>
          </div>
        }
      >
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">当前部门</label>
            <p className="px-4 py-2 bg-slate-50 border border-slate-100 rounded-lg text-sm font-bold text-slate-500">{findDeptName(selectedDeptId)}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              成员数据
              <span className="text-xs text-slate-400 font-normal ml-1">（每行一条，格式：姓名,登录账号,角色,邮箱,手机，登录账号必填）</span>
            </label>
            <textarea
              rows={10}
              placeholder={`示例：\n张三,zhangsan,系统管理员,zhang@hospital.com,13800000001\n李四,lisi,督办专员,li@hospital.com,13800000002\n王五,wangwu,普通员工,,`}
              className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm font-mono resize-none"
              value={batchImportText}
              onChange={(e) => setBatchImportText(e.target.value)}
            />
          </div>
          <div className="bg-blue-50/50 rounded-lg p-3 text-xs text-slate-500 space-y-1">
            <p className="font-semibold text-slate-600">格式说明：</p>
            <p>每行一条成员记录，用英文逗号分隔</p>
            <p>第1列：姓名（必填）</p>
            <p>第2列：登录账号（必填）</p>
            <p>第3列：系统角色（可选，默认为"普通员工"）</p>
            <p>第4列：电子邮箱（可选）</p>
            <p>第5列：手机号码（可选）</p>
          </div>
        </div>
      </Drawer>
    </MainLayout>
  );
};

export default OrgManagement;
