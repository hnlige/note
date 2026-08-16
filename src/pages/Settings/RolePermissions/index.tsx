import React, { useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, ChevronRight, Download, Edit3, Eye, FileSearch, Plus, Search, Settings2, Shield, ShieldCheck, Users, X } from 'lucide-react';
import { MainLayout } from '../../../components/Layout/MainLayout';
import { Drawer } from '../../../components/Common/Drawer';
import { useToast } from '../../../components/Common/Toast';
import { useStore } from '../../../store/useStore';
import { getDisplayRoleName } from '../../../store/role-access';
import { Role, AllowedAction, DeptNode } from '../../../types';
import {
  buildNewRole,
  canManageRolePermissions,
  canToggleAllowedAction,
  getEditableAuthCodes,
  isPageActionChecked,
  isPermissionChecked,
  materializeAllowedPageActions,
  togglePageAllowedAction,
  togglePermissionCode,
} from './role-permissions';
import {
  getAllPermissionCodes,
  PERMISSION_TREE,
} from './permission-catalog';

const flattenDepts = (nodes: DeptNode[]): { id: string; name: string }[] => {
  const result: { id: string; name: string }[] = [];
  nodes.forEach((node) => {
    result.push({ id: node.id, name: node.name });
    if (node.children) {
      result.push(...flattenDepts(node.children));
    }
  });
  return result;
};

const ACTION_ICONS: Partial<Record<AllowedAction, React.ReactNode>> = {
  READ: <Eye className="w-4 h-4" />,
  SEARCH: <FileSearch className="w-4 h-4" />,
  EXPORT: <Download className="w-4 h-4" />,
  EDIT_ITEM: <Edit3 className="w-4 h-4" />,
  EDIT_SYSTEM: <Settings2 className="w-4 h-4" />,
};

const ROLE_SCOPE_OPTIONS: { label: string; desc: string; value: Role['dataScope'] }[] = [
  { label: '全集团范围', desc: '可查看全集团内所有督办事项。适用于超级管理员。', value: 'ALL' },
  { label: '本部门范围', desc: '可查看本部门及下级部门内事项。适用于部门管理员。', value: 'DEPT' },
  { label: '本人及全部下级', desc: '可查看本人及所有层级下级负责的事项。', value: 'SELF_AND_DIRECT_SUBORDINATES' },
  { label: '指定组织', desc: '按授权组织范围过滤事项。', value: 'MULTI_ORG' },
  { label: '仅限个人', desc: '仅可查看本人负责的事项。', value: 'SELF' },
];

const FOLLOWER_SCOPE_OPTIONS: { label: string; desc: string; value: Role['followerDataScope'] | 'NONE' }[] = [
  { label: '全集团范围', desc: '可查看全集团内所有跟进事项。', value: 'ALL' },
  { label: '本部门范围', desc: '可查看本部门及下级部门内跟进事项。', value: 'DEPT' },
  { label: '本人及全部下级', desc: '可查看本人及所有层级下级跟进事项。', value: 'SELF_AND_DIRECT_SUBORDINATES' },
  { label: '指定组织', desc: '按授权组织范围过滤跟进事项。', value: 'MULTI_ORG' },
  { label: '仅限个人', desc: '仅可查看本人跟进的事项。', value: 'SELF' },
  { label: '不配置', desc: '不启用跟进人维度过滤。', value: 'NONE' },
];

const CUSTOM_USER_SECTIONS: {
  key: 'ownerCustomUserIds' | 'followerCustomUserIds';
  title: string;
  description: string;
  badge: string;
  color: 'indigo' | 'emerald';
}[] = [
  {
    key: 'ownerCustomUserIds',
    title: '责任人维度指定人员',
    description: '仅对责任人维度的部门管理员额外生效。',
    badge: '责任人',
    color: 'indigo',
  },
  {
    key: 'followerCustomUserIds',
    title: '跟进人维度指定人员',
    description: '仅对跟进人维度的部门管理员额外生效。',
    badge: '跟进人',
    color: 'emerald',
  },
];

const RolePermissions: React.FC = () => {
  const { roles, updateRole, addRole, deleteRole, addLog, currentUser, departments, orgUsers, syncOrgUsers, syncRoles } = useStore();
  const { showToast } = useToast();

  const [selectedRoleId, setSelectedRoleId] = useState(roles[0]?.id || '');
  const [draftRole, setDraftRole] = useState<Role | undefined>(roles[0]);
  const [roleSearch, setRoleSearch] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreatingRole, setIsCreatingRole] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [editRoleId, setEditRoleId] = useState('');
  const [editRoleName, setEditRoleName] = useState('');
  const [showOrgSelector, setShowOrgSelector] = useState(false);
  const [showCustomUserSelector, setShowCustomUserSelector] = useState<'owner' | 'follower' | false>(false);
  const [customUserSearch, setCustomUserSearch] = useState('');
  const [customUserDeptFilter, setCustomUserDeptFilter] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; roleId: string; roleName: string }>({ open: false, roleId: '', roleName: '' });

  const canManageRoles = useMemo(
    () => canManageRolePermissions(currentUser, roles),
    [currentUser, roles],
  );

  const deptNameById = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: typeof departments) => {
      nodes.forEach((node) => {
        map.set(node.id, node.name);
        if (node.children) walk(node.children);
      });
    };
    walk(departments);
    return map;
  }, [departments]);

  const topLevelOrgs = useMemo(() => departments.flatMap((dept) => dept.children || []).map((child) => ({ id: child.id, name: child.name })), [departments]);
  const deptOptions = useMemo(() => flattenDepts(departments), [departments]);

  const filteredCustomUsers = useMemo(() => {
    const keyword = customUserSearch.trim().toLowerCase();
    return orgUsers.filter((user) => {
      if (user.status !== 'ACTIVE') return false;
      if (customUserDeptFilter && user.deptId !== customUserDeptFilter) return false;
      if (!keyword) return true;
      const deptName = user.deptId ? deptNameById.get(user.deptId) || '' : '';
      return [user.name, user.username, user.role, deptName].some((value) => value.toLowerCase().includes(keyword));
    });
  }, [customUserDeptFilter, customUserSearch, deptNameById, orgUsers]);

  const filteredRoles = useMemo(() => {
    const keyword = roleSearch.trim().toLowerCase();
    if (!keyword) return roles;
    return roles.filter((role) => role.name.toLowerCase().includes(keyword));
  }, [roleSearch, roles]);
  const selectedRole = draftRole;
  const allPermissionCodes = useMemo(
    () => getAllPermissionCodes(PERMISSION_TREE),
    [],
  );
  const editableAuthCodes = useMemo(
    () => getEditableAuthCodes(selectedRole?.authCodes, allPermissionCodes),
    [allPermissionCodes, selectedRole?.authCodes],
  );

  useEffect(() => {
    const nextRole = roles.find((role) => role.id === selectedRoleId) || roles[0];
    setDraftRole(nextRole ? {
      ...nextRole,
      ownerCustomUserIds: nextRole.ownerCustomUserIds ?? nextRole.customUserIds ?? [],
      followerCustomUserIds: nextRole.followerCustomUserIds ?? nextRole.customUserIds ?? [],
      // 将全局操作权限铺开为显式页面级按钮列表，使每个按钮可独立勾选/取消
      allowedPageActions: materializeAllowedPageActions(nextRole),
    } : undefined);
    if (nextRole && nextRole.id !== selectedRoleId) {
      setSelectedRoleId(nextRole.id);
    }
  }, [roles, selectedRoleId]);

  const usesSharedOrgScope = selectedRole?.dataScope === 'MULTI_ORG' || selectedRole?.followerDataScope === 'MULTI_ORG';

  const patchDraftRole = (updates: Partial<Role>) => {
    setDraftRole((current) => (current ? { ...current, ...updates } : current));
  };

  const getSelectedCustomUsers = (field: 'ownerCustomUserIds' | 'followerCustomUserIds') => selectedRole?.[field] || [];

  const togglePermission = (code: string) => {
    if (!selectedRole) return;
    patchDraftRole({ authCodes: togglePermissionCode(selectedRole.authCodes, code, allPermissionCodes) });
  };

  const toggleRoleAllowedAction = (pageAuth: string, action: AllowedAction) => {
    if (!selectedRole) return;
    patchDraftRole({
      allowedPageActions: togglePageAllowedAction(selectedRole.allowedPageActions, pageAuth, action),
    });
  };

  const toggleSelectAll = (authCodes: string[]) => {
    if (!selectedRole) return;
    const allSelected = authCodes.every((code) => editableAuthCodes.includes(code));
    const nextCodes = allSelected
      ? editableAuthCodes.filter((code) => !authCodes.includes(code))
      : [...new Set([...editableAuthCodes, ...authCodes])];
    patchDraftRole({ authCodes: nextCodes });
  };

  const toggleOrgId = (orgId: string) => {
    if (!selectedRole) return;
    const current = selectedRole.orgIds || [];
    const next = current.includes(orgId) ? current.filter((item) => item !== orgId) : [...current, orgId];
    patchDraftRole({ orgIds: next });
  };

  const toggleCustomUserId = (field: 'ownerCustomUserIds' | 'followerCustomUserIds', userId: string) => {
    if (!selectedRole) return;
    const current = getSelectedCustomUsers(field);
    const next = current.includes(userId) ? current.filter((item) => item !== userId) : [...current, userId];
    patchDraftRole({ [field]: next } as Partial<Role>);
  };

  const setDataScope = (scope: Role['dataScope']) => {
    if (!selectedRole) return;
    const keepSharedOrgs = scope === 'MULTI_ORG' || selectedRole.followerDataScope === 'MULTI_ORG';
    patchDraftRole({
      dataScope: scope,
      ...(keepSharedOrgs ? {} : { orgIds: [] }),
    });
  };

  const setFollowerScope = (scope: Role['followerDataScope'] | 'NONE') => {
    if (!selectedRole) return;
    if (scope === 'NONE') {
      patchDraftRole({ followerDataScope: undefined });
      return;
    }
    const keepSharedOrgs = selectedRole.dataScope === 'MULTI_ORG' || scope === 'MULTI_ORG';
    patchDraftRole({
      followerDataScope: scope,
      ...(keepSharedOrgs ? {} : { orgIds: [] }),
    });
  };

  const handleCreateRole = async () => {
    const roleName = newRoleName.trim();
    if (!roleName || isCreatingRole) return;
    const duplicate = roles.find((role) => role.name === roleName);
    if (duplicate) {
      showToast(`角色名「${roleName}」已存在`, 'warning');
      return;
    }
    const newId = `r${Math.random().toString(36).slice(2, 9)}`;
    try {
      setIsCreatingRole(true);
      await addRole(buildNewRole(newId, roleName));
      setIsCreateOpen(false);
      setNewRoleName('');
      setSelectedRoleId(newId);
      addLog({ userName: currentUser.name, userId: currentUser.id, action: `新增角色: ${roleName}`, module: '角色管理' });
      showToast(`角色「${roleName}」已创建`, 'success');
    } catch (error) {
      console.warn('新增角色失败:', error);
      const err = error as { status?: number; message?: string };
      const status = typeof err.status === 'number' ? err.status : undefined;
      const serverMsg = err.message || '';
      if (status === 401) {
        showToast('登录状态已失效，请重新登录后再试', 'warning');
      } else if (status === 403) {
        showToast(serverMsg || '当前账号无权限新增角色', 'warning');
      } else {
        showToast(`新增角色失败：${serverMsg || '后端未成功落库，请稍后重试'}`, 'warning');
      }
    } finally {
      setIsCreatingRole(false);
    }
  };

  const handleEditRole = (e: React.MouseEvent, role: Role) => {
    e.stopPropagation();
    setEditRoleId(role.id);
    setEditRoleName(role.name);
    setIsEditOpen(true);
  };

  const handleDeleteRole = (e: React.MouseEvent, role: Role) => {
    e.stopPropagation();
    setDeleteConfirm({ open: true, roleId: role.id, roleName: role.name });
  };

  const confirmDeleteRole = () => {
    const role = roles.find((item) => item.id === deleteConfirm.roleId);
    if (!role) return;
    deleteRole(role.id);
    if (selectedRoleId === role.id) {
      const remaining = roles.filter((item) => item.id !== role.id);
      setSelectedRoleId(remaining[0]?.id || '');
    }
    addLog({ userName: currentUser.name, userId: currentUser.id, action: `删除角色: ${role.name}`, module: '角色管理' });
    showToast(`角色「${role.name}」已删除`, 'success');
    setDeleteConfirm({ open: false, roleId: '', roleName: '' });
  };

  const handleSaveEditRole = async () => {
    if (!editRoleName.trim()) {
      showToast('角色名称不能为空', 'warning');
      return;
    }
    const duplicate = roles.find((role) => role.name === editRoleName.trim() && role.id !== editRoleId);
    if (duplicate) {
      showToast(`角色名「${editRoleName.trim()}」已存在`, 'warning');
      return;
    }
    try {
      await updateRole(editRoleId, { name: editRoleName.trim() });
      await Promise.allSettled([syncRoles(), syncOrgUsers()]);
      addLog({ userName: currentUser.name, userId: currentUser.id, action: `编辑角色名称: ${editRoleName.trim()}`, module: '角色管理' });
      showToast('角色名称已更新', 'success');
      setIsEditOpen(false);
    } catch (error) {
      console.warn('更新角色名称失败:', error);
      showToast('角色名称更新失败，请稍后重试', 'warning');
    }
  };

  const handleSave = async () => {
    if (!selectedRole) return;
    try {
      const { api } = await import('../../../lib/api');
      await api.roles.update(selectedRole.id, {
        permissions: selectedRole.authCodes,
        dataScope: selectedRole.dataScope,
        followerDataScope: selectedRole.followerDataScope ?? null,
        allowedActions: selectedRole.allowedActions,
        allowedPageActions: selectedRole.allowedPageActions || {},
        orgIds: selectedRole.orgIds,
        ownerCustomUserIds: selectedRole.ownerCustomUserIds || [],
        followerCustomUserIds: selectedRole.followerCustomUserIds || [],
        customUserIds: [...new Set([...(selectedRole.ownerCustomUserIds || []), ...(selectedRole.followerCustomUserIds || []), ...(selectedRole.customUserIds || [])])],
      });
      await syncRoles();
      addLog({ userName: currentUser.name, userId: currentUser.id, action: `更新角色权限: ${selectedRole.name}`, module: '角色管理' });
      showToast('权限配置已保存', 'success');
    } catch (error) {
      console.warn('保存到后端失败:', error);
      const err = error as { status?: number; message?: string };
      const status = typeof err.status === 'number' ? err.status : undefined;
      const serverMsg = err.message || '';
      if (status === 401) {
        showToast('登录状态已失效，请重新登录后再保存', 'warning');
      } else if (status === 403) {
        showToast(serverMsg || '当前账号无权限修改该角色配置', 'warning');
      } else if (status === 400) {
        showToast(serverMsg || '请求参数有误，请检查后重试', 'warning');
      } else {
        showToast(`保存失败：${serverMsg || '后端未成功落库，请稍后重试'}`, 'warning');
      }
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">角色及数据权限</h1>
          <p className="text-slate-500 text-sm mt-1">统一维护角色功能权限、责任人维度与跟进人维度的数据范围。</p>
        </div>
        {canManageRoles && (
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-all shadow-sm active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>新增角色</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 h-[calc(100vh-200px)]">
        <div className="xl:col-span-1 bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-50 bg-slate-50/30">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="搜索角色名称..."
                value={roleSearch}
                onChange={(e) => setRoleSearch(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg py-2 pl-10 pr-4 text-xs focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredRoles.map((role) => {
              const active = selectedRoleId === role.id;
              return (
                <button
                  key={role.id}
                  onClick={() => setSelectedRoleId(role.id)}
                  className={`w-full flex items-center justify-between p-4 rounded-xl transition-all group ${active ? 'bg-blue-50 text-blue-600 border border-blue-100' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${active ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
                      <Shield className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-bold">{role.name}</p>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{role.authCodes.length} 个功能权限</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {canManageRoles && (
                      <button
                        onClick={(e) => handleEditRole(e, role)}
                        className="p-1.5 rounded-lg text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition-all opacity-0 group-hover:opacity-100"
                        title="编辑角色"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canManageRoles && (
                      <button
                        onClick={(e) => handleDeleteRole(e, role)}
                        className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                        title="删除角色"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <ChevronRight className={`w-4 h-4 transition-transform ${active ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0 group-hover:opacity-100 group-hover:translate-x-0'}`} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col overflow-hidden">
          <div className="p-6 border-b border-slate-50 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
                <Settings2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-slate-900 truncate">权限配置：{selectedRole?.name || '未选择角色'}</h3>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">责任人维度 + 跟进人维度 + 指定人员拆分配置</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {canManageRoles && (
                <button
                  onClick={() => {
                    if (!selectedRole) return;
                    addLog({ userName: currentUser.name, userId: currentUser.id, action: `复制角色权限: ${selectedRole.name}`, module: '角色管理' });
                    showToast('权限配置已复制，可在新增角色时复用', 'success');
                  }}
                  className="bg-white text-slate-700 border border-slate-200 px-3 py-2 rounded-lg font-medium text-xs hover:bg-slate-50 transition-all"
                >
                  复制权限
                </button>
              )}
              <button
                onClick={() => {
                  if (!selectedRole) return;
                  showToast(`角色: ${selectedRole.name} | 功能权限: ${selectedRole.authCodes.length} | 责任人范围: ${selectedRole.dataScope} | 跟进人范围: ${selectedRole.followerDataScope || 'NONE'} | 指定人员: ${(selectedRole.customUserIds || []).length} 人`, 'info');
                }}
                className="bg-white text-slate-700 border border-slate-200 px-3 py-2 rounded-lg font-medium text-xs hover:bg-slate-50 transition-all"
              >
                预览权限
              </button>
              {canManageRoles && (
                <button
                  onClick={handleSave}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold text-sm hover:bg-blue-700 transition-all shadow-md shadow-blue-100"
                >
                  保存更改
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-8 space-y-10">
            <section>
              <div className="flex items-center gap-2 mb-6">
                <div className="w-1 h-4 bg-blue-600 rounded-full" />
                <h4 className="text-sm font-bold text-slate-900 uppercase tracking-widest">三级功能权限</h4>
              </div>
              <div className="space-y-4">
                {PERMISSION_TREE.map((group) => {
                  const authCodes = group.children.map((item) => item.auth);
                  const allSelected = selectedRole ? authCodes.every((code) => editableAuthCodes.includes(code)) : false;
                  return (
                    <div key={group.label} className="bg-slate-50/50 rounded-2xl border border-slate-100 overflow-hidden">
                      <div className="px-4 py-2 bg-slate-100/50 border-b border-slate-100 flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">系统菜单：{group.label}</span>
                        <button
                          onClick={() => toggleSelectAll(authCodes)}
                          className={`text-[10px] font-bold transition-colors ${allSelected ? 'text-blue-600' : 'text-slate-400 hover:text-blue-600'}`}
                        >
                          {allSelected ? '取消全选' : '全选'}
                        </button>
                      </div>
                      <div className="p-4 grid grid-cols-1 gap-4">
                        {group.children.map((item) => {
                          const checked = isPermissionChecked(selectedRole?.authCodes, item.auth);
                          return (
                            <div
                              key={item.auth}
                              className={`rounded-xl border transition-colors ${checked ? 'bg-white border-blue-200 shadow-sm shadow-blue-50' : 'bg-white border-slate-100 hover:border-blue-200'}`}
                            >
                              <button
                                type="button"
                                onClick={() => togglePermission(item.auth)}
                                className="w-full flex items-center justify-between p-3 text-left group"
                              >
                                <div className="flex items-center gap-3">
                                  <ShieldCheck className={`w-4 h-4 ${checked ? 'text-blue-500' : 'text-slate-300'}`} />
                                  <div>
                                    <span className="text-xs font-semibold text-slate-700">页面：{item.label}</span>
                                    <p className="text-[10px] text-slate-400 mt-0.5">{item.auth}</p>
                                  </div>
                                </div>
                                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${checked ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-200'}`}>
                                  {checked && <CheckCircle2 className="w-3 h-3 text-white" />}
                                </div>
                              </button>
                              <div className={`border-t border-slate-100 px-3 py-3 ${checked ? 'bg-blue-50/20' : 'bg-slate-50/70'}`}>
                                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                                  {item.actions.map((action) => {
                                    const actionChecked = isPageActionChecked(selectedRole, item.auth, action.value);
                                    const canToggle = canToggleAllowedAction(action.value);
                                    const actionIcon = ACTION_ICONS[action.value] || ACTION_ICONS.EDIT_ITEM;
                                    return (
                                      <label
                                        key={`${item.auth}-${action.value}`}
                                        className={`flex items-center gap-2.5 p-2.5 rounded-lg border transition-all ${checked && canToggle ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'} ${actionChecked ? 'bg-white border-amber-200 shadow-sm' : 'bg-white border-slate-100'}`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={actionChecked}
                                          disabled={!checked || !canToggle}
                                          onChange={() => toggleRoleAllowedAction(item.auth, action.value)}
                                          className="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500"
                                        />
                                        <span className={`${actionChecked ? 'text-amber-600' : 'text-slate-400'} shrink-0`}>{actionIcon}</span>
                                        <div className="min-w-0">
                                          <p className={`text-xs font-semibold ${actionChecked ? 'text-slate-900' : 'text-slate-600'}`}>按钮：{action.label}</p>
                                          <p className="text-[10px] text-slate-400 truncate">{action.desc}</p>
                                        </div>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-6">
                <div className="w-1 h-4 bg-indigo-600 rounded-full" />
                <h4 className="text-sm font-bold text-slate-900 uppercase tracking-widest">数据权限</h4>
              </div>
              <div className="grid grid-cols-1 gap-8">
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">责任人维度</span>
                    <span className="text-[10px] text-slate-400">按负责人过滤</span>
                  </div>
                  <div className="space-y-3">
                    {ROLE_SCOPE_OPTIONS.map((option) => (
                      <label
                        key={option.value}
                        className={`flex items-start gap-4 p-4 rounded-xl border cursor-pointer transition-all ${selectedRole?.dataScope === option.value ? 'bg-indigo-50/50 border-indigo-100 ring-1 ring-indigo-100' : 'bg-white border-slate-100 hover:bg-slate-50'}`}
                      >
                        <input
                          type="radio"
                          name="ownerDataScope"
                          checked={selectedRole?.dataScope === option.value}
                          onChange={() => setDataScope(option.value)}
                          className="mt-1 w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-slate-300"
                        />
                        <div>
                          <p className="text-sm font-bold text-slate-900">{option.label}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{option.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>

                  {usesSharedOrgScope && (
                    <div className="mt-4 p-4 bg-indigo-50/30 rounded-xl border border-indigo-100">
                      <div className="flex items-center justify-between mb-3 gap-4">
                        <span className="text-xs font-bold text-indigo-700 flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5" />
                          已选组织 ({selectedRole?.orgIds?.length || 0} 个)
                        </span>
                        <button
                          onClick={() => setShowOrgSelector((visible) => !visible)}
                          className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                        >
                          {showOrgSelector ? '收起' : '选择组织'}
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 mb-3">当责任人维度或跟进人维度选择「指定组织」时，共用这里的组织授权配置。</p>
                      {selectedRole?.orgIds && selectedRole.orgIds.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {selectedRole.orgIds.map((orgId) => {
                            const org = topLevelOrgs.find((item) => item.id === orgId);
                            return org ? (
                              <span key={orgId} className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold">
                                {org.name}
                                <button onClick={() => toggleOrgId(orgId)} className="hover:text-red-500 transition-colors">
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                      {showOrgSelector && (
                        <div className="border border-indigo-100 bg-white rounded-lg p-3 max-h-48 overflow-y-auto space-y-1">
                          {topLevelOrgs.map((org) => (
                            <label key={org.id} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-indigo-50 cursor-pointer transition-colors">
                              <input
                                type="checkbox"
                                checked={selectedRole?.orgIds?.includes(org.id) || false}
                                onChange={() => toggleOrgId(org.id)}
                                className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                              />
                              <span className="text-sm font-medium text-slate-700">{org.name}</span>
                            </label>
                          ))}
                          {topLevelOrgs.length === 0 && <p className="text-xs text-slate-400 text-center py-4">暂无组织数据</p>}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-8 space-y-6">
                    {CUSTOM_USER_SECTIONS.map((section) => {
                      const selectedIds = getSelectedCustomUsers(section.key);
                      const selectedUsers = selectedIds.map((userId) => orgUsers.find((item) => item.id === userId)).filter(Boolean) as typeof orgUsers;
                      return (
                        <div key={section.key} className="p-4 bg-slate-50/80 rounded-xl border border-slate-100">
                          <div className="flex items-center justify-between mb-3 gap-4">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${section.color === 'indigo' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>{section.badge}</span>
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-800 truncate">{section.title}</p>
                                <p className="text-xs text-slate-500">{section.description}</p>
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                if (section.key === 'ownerCustomUserIds') {
                                  setShowCustomUserSelector((visible) => visible === 'owner' ? false : 'owner');
                                } else {
                                  setShowCustomUserSelector((visible) => visible === 'follower' ? false : 'follower');
                                }
                              }}
                              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                            >
                              {showCustomUserSelector === (section.key === 'ownerCustomUserIds' ? 'owner' : 'follower') ? '收起' : '选择人员'}
                            </button>
                          </div>
                          <div className="flex items-center justify-between mb-3 gap-4 text-xs text-slate-500">
                            <span className="flex items-center gap-1.5 text-slate-700 font-semibold">
                              <Users className="w-3.5 h-3.5" />
                              已选人员 ({selectedIds.length} 人)
                            </span>
                            <span>责任人 / 跟进人部门管理员共享</span>
                          </div>
                          {selectedUsers.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-3">
                              {selectedUsers.map((user) => (
                                <span key={user.id} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold ${section.color === 'indigo' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                  {user.name}
                                  <button onClick={() => toggleCustomUserId(section.key, user.id)} className="hover:text-red-500 transition-colors">
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                          {showCustomUserSelector === (section.key === 'ownerCustomUserIds' ? 'owner' : 'follower') && (
                            <div className="border border-slate-200 bg-white rounded-xl p-4 space-y-3">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="relative">
                                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                  <input
                                    type="text"
                                    placeholder="搜索姓名、账号、角色..."
                                    value={customUserSearch}
                                    onChange={(e) => setCustomUserSearch(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 pl-10 pr-3 text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
                                  />
                                </div>
                                <select
                                  value={customUserDeptFilter}
                                  onChange={(e) => setCustomUserDeptFilter(e.target.value)}
                                  className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer"
                                >
                                  <option value="">全部部门</option>
                                  {deptOptions.map((dept) => (
                                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-slate-400">
                                <span>共 {filteredCustomUsers.length} 人可选</span>
                                <span>已选 {selectedIds.length} 人</span>
                              </div>
                              <div className="border border-slate-200 bg-white rounded-lg p-3 max-h-56 overflow-y-auto space-y-1">
                                {filteredCustomUsers.map((user) => (
                                  <label key={user.id} className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <input
                                        type="checkbox"
                                        checked={selectedIds.includes(user.id)}
                                        onChange={() => toggleCustomUserId(section.key, user.id)}
                                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                                      />
                                      <div className="min-w-0">
                                        <span className="text-sm font-medium text-slate-700">{user.name}</span>
                                        <p className="text-[10px] text-slate-400 truncate">{user.deptId ? `部门：${deptNameById.get(user.deptId) || user.deptId}` : '未设置部门'}</p>
                                      </div>
                                    </div>
                                    <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">{getDisplayRoleName(user, roles)}</span>
                                  </label>
                                ))}
                                {filteredCustomUsers.length === 0 && <p className="text-xs text-slate-400 text-center py-4">无匹配人员</p>}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">跟进人维度</span>
                    <span className="text-[10px] text-slate-400">按跟进人过滤</span>
                  </div>
                  <div className="space-y-3">
                    {FOLLOWER_SCOPE_OPTIONS.map((option) => {
                      const checked = (selectedRole?.followerDataScope || 'NONE') === option.value;
                      return (
                        <label
                          key={option.value}
                          className={`flex items-start gap-4 p-4 rounded-xl border cursor-pointer transition-all ${checked ? 'bg-indigo-50/50 border-indigo-100 ring-1 ring-indigo-100' : 'bg-white border-slate-100 hover:bg-slate-50'} ${option.value === 'NONE' ? 'border-dashed' : ''}`}
                        >
                          <input
                            type="radio"
                            name="followerDataScope"
                            checked={checked}
                            onChange={() => setFollowerScope(option.value)}
                            className="mt-1 w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-slate-300"
                          />
                          <div>
                            <p className="text-sm font-bold text-slate-900">{option.label}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{option.desc}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-6">
                <div className="w-1 h-4 bg-amber-600 rounded-full" />
                <h4 className="text-sm font-bold text-slate-900 uppercase tracking-widest">页面 + 按钮权限总览</h4>
              </div>
              <div className="bg-amber-50/30 border border-amber-100 rounded-2xl p-6">
                <p className="text-xs text-slate-500 mb-4">按钮权限按页面独立配置；旧版全局按钮权限继续按兼容规则回显。</p>
                {selectedRole && PERMISSION_TREE.some((group) => group.children.some((page) => page.actions.some((action) => isPageActionChecked(selectedRole, page.auth, action.value)))) ? (
                  <div className="flex flex-wrap gap-2">
                    {PERMISSION_TREE.flatMap((group) => group.children).flatMap((page) =>
                      page.actions
                        .filter((action) => isPageActionChecked(selectedRole, page.auth, action.value))
                        .map((action) => (
                          <span key={`${page.auth}-${action.value}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-amber-200 text-amber-800 rounded-lg text-xs font-semibold">
                            <CheckCircle2 className="w-3 h-3" />
                            {page.label} · {action.label}
                          </span>
                        )),
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-amber-100/50 rounded-xl border border-amber-200">
                    <p className="text-xs font-semibold text-amber-800">当前角色未配置可用的页面按钮权限。</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      <Drawer
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="新增系统角色"
        footer={
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setIsCreateOpen(false)}
              disabled={isCreatingRole}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              取消
            </button>
            <button
              onClick={handleCreateRole}
              disabled={isCreatingRole}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isCreatingRole ? '创建中...' : '确定创建'}
            </button>
          </div>
        }
      >
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">角色名称</label>
            <input
              type="text"
              placeholder="请输入角色名称，如：财务审计专员"
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
            />
          </div>
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
            <p className="text-xs text-blue-700 leading-relaxed">提示：新角色创建后默认开启“工作台”首页权限，后续可在本页继续配置功能权限和数据范围。</p>
          </div>
        </div>
      </Drawer>

      <Drawer
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title="编辑角色名称"
        width="w-[420px]"
        footer={
          <div className="flex gap-3 justify-end">
            <button onClick={() => setIsEditOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">取消</button>
            <button onClick={handleSaveEditRole} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all">保存</button>
          </div>
        }
      >
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">角色名称</label>
            <input
              type="text"
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={editRoleName}
              onChange={(e) => setEditRoleName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEditRole();
              }}
            />
          </div>
        </div>
      </Drawer>

      {deleteConfirm.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setDeleteConfirm({ open: false, roleId: '', roleName: '' })} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-8 w-[400px] max-w-[90vw]">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-red-500 shrink-0">
                <X className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">删除角色</h3>
                <p className="text-sm text-slate-500 mt-1">确定要删除角色「<span className="font-semibold text-slate-700">{deleteConfirm.roleName}</span>」吗？</p>
              </div>
            </div>
            <p className="text-xs text-slate-400 mb-6">删除后不可恢复，该角色下的用户将失去对应权限配置。</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm({ open: false, roleId: '', roleName: '' })} className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors">取消</button>
              <button onClick={confirmDeleteRole} className="px-5 py-2.5 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-colors">确定删除</button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
};

export default RolePermissions;
