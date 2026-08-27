import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { X, ChevronDown, Loader2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useToast } from './Toast';
import { Drawer } from './Drawer';
import { isManualDateOnOrAfter, isValidManualDateInput, normalizeManualDateInput, todayDateString } from '../../lib/item-format';
import { DeptNode } from '../../types';
import { getInitialFollowers, isFollowerCandidate } from './create-item-modal-helpers';
import type { ItemPageAuth } from '../../lib/api';

interface CreateItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  pageAuth: ItemPageAuth;
}

const flattenDepts = (nodes: DeptNode[]): string[] => {
  const result: string[] = [];
  for (const node of nodes) {
    result.push(node.name);
    if (node.children) result.push(...flattenDepts(node.children));
  }
  return result;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '同步到后端失败，请重试';
};

const getErrorStatus = (error: unknown) => (
  typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status?: number }).status
    : undefined
);

export const CreateItemModal: React.FC<CreateItemModalProps> = ({ isOpen, onClose, pageAuth }) => {
  const { currentUser, items, addItem, addItemToBackend, addActivity, addLog, orgUsers, departments } = useStore();
  const { showToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncingOrgUsers] = useState(false);

  const activeUsers = useMemo(() =>
    orgUsers.filter(u => u.status === 'ACTIVE').map(u => ({ id: u.id, name: u.name, username: u.username })),
    [orgUsers]
  );

  const activeFollowerUsers = useMemo(() =>
    orgUsers
      .filter(u => u.status === 'ACTIVE' && isFollowerCandidate(u))
      .map(u => ({ id: u.id, name: u.name, username: u.username })),
    [orgUsers]
  );

  const deptCandidates = useMemo(() => Array.from(new Set(flattenDepts(departments))), [departments]);

  const today = todayDateString();

  const getDeptName = useCallback((deptId: string, nodes: DeptNode[]): string => {
    for (const node of nodes) {
      if (node.id === deptId) return node.name;
      if (node.children) {
        const found = getDeptName(deptId, node.children);
        if (found) return found;
      }
    }
    return '';
  }, []);

  const activeUsersWithDept = useMemo(() =>
    orgUsers
      .filter(u => u.status === 'ACTIVE')
      .map(u => ({
        id: u.id,
        name: u.name,
        username: u.username,
        role: u.role,
        roleId: u.roleId,
        deptName: getDeptName(u.deptId, departments),
      })),
    [orgUsers, departments, getDeptName]
  );

  const [showFollowerDropdown, setShowFollowerDropdown] = useState(false);
  const followerDropdownRef = useRef<HTMLDivElement>(null);
  const [showOwnerDropdown, setShowOwnerDropdown] = useState(false);
  const ownerDropdownRef = useRef<HTMLDivElement>(null);
  const [showDeptDropdown, setShowDeptDropdown] = useState(false);
  const deptDropdownRef = useRef<HTMLDivElement>(null);
  const [deptSearch, setDeptSearch] = useState('');

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (followerDropdownRef.current && !followerDropdownRef.current.contains(e.target as Node)) {
        setShowFollowerDropdown(false);
      }
      if (ownerDropdownRef.current && !ownerDropdownRef.current.contains(e.target as Node)) {
        setShowOwnerDropdown(false);
      }
      if (deptDropdownRef.current && !deptDropdownRef.current.contains(e.target as Node)) {
        setShowDeptDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [formData, setFormData] = useState({
    serialNo: '',
    content: '',
    meetingName: '',
    raiseDate: '',
    requiredCompletionDate: '',
    plannedCompletionDate: '',
    actualCompletionDate: '',
  });

  const [followers, setFollowers] = useState<{ id: string; name: string }[]>(getInitialFollowers);
  const [followerInput, setFollowerInput] = useState('');
  const [depts, setDepts] = useState<string[]>([]);
  const [owners, setOwners] = useState<{ id: string; name: string }[]>([]);
  const [ownerInput, setOwnerInput] = useState('');

  const addFollower = () => {
    if (!followerInput.trim()) return;
    const input = followerInput.trim();
    const match = activeFollowerUsers.find(f => f.name === input || f.id === input)
      || activeFollowerUsers.find(f => f.name.includes(input) || f.username.includes(input));
    if (match && !followers.some(f => f.id === match.id)) {
      setFollowers(prev => [...prev, { id: match.id, name: match.name }]);
    }
    setFollowerInput('');
    setShowFollowerDropdown(false);
  };

  const selectFollower = (user: { id: string; name: string }) => {
    if (!followers.some(f => f.id === user.id)) {
      setFollowers(prev => [...prev, user]);
    }
    setFollowerInput('');
    setShowFollowerDropdown(false);
  };

  const filteredFollowerCandidates = useMemo(
    () => activeUsersWithDept.filter(u =>
      isFollowerCandidate(u) &&
      !followers.some(f => f.id === u.id) &&
      (!followerInput.trim() || u.name.includes(followerInput.trim()) || u.username.includes(followerInput.trim()) || u.role.includes(followerInput.trim()))
    ),
    [activeUsersWithDept, followers, followerInput]
  );

  const removeFollower = (id: string) => {
    setFollowers(prev => prev.filter(f => f.id !== id));
  };

  // 部门搜索过滤
  const filteredDepts = useMemo(
    () => deptCandidates
      .filter(name => !deptSearch.trim() || name.toLowerCase().includes(deptSearch.trim().toLowerCase()))
      .map(name => ({ value: name, label: name })),
    [deptCandidates, deptSearch]
  );

  const removeDept = (name: string) => {
    setDepts(prev => prev.filter(d => d !== name));
  };

  const addOwner = () => {
    if (!ownerInput.trim()) return;
    const input = ownerInput.trim();
    const match = activeUsers.find(o => o.name === input || o.id === input)
      || activeUsers.find(o => o.name.includes(input) || o.username.includes(input));
    if (match && !owners.some(o => o.id === match.id)) {
      setOwners(prev => [...prev, { id: match.id, name: match.name }]);
    }
    setOwnerInput('');
    setShowOwnerDropdown(false);
  };

  const selectOwner = (user: { id: string; name: string }) => {
    if (!owners.some(o => o.id === user.id)) {
      setOwners(prev => [...prev, user]);
    }
    setOwnerInput('');
    setShowOwnerDropdown(false);
  };

  const filteredOwnerCandidates = useMemo(
    () => activeUsersWithDept.filter(u =>
      !owners.some(o => o.id === u.id) &&
      (!ownerInput.trim() || u.name.includes(ownerInput.trim()) || u.username.includes(ownerInput.trim()) || u.role.includes(ownerInput.trim()))
    ),
    [activeUsersWithDept, owners, ownerInput]
  );

  const removeOwner = (id: string) => {
    setOwners(prev => prev.filter(o => o.id !== id));
  };

  const resetForm = () => {
    setFormData({
      serialNo: '',
      content: '',
      meetingName: '',
      raiseDate: '',
      requiredCompletionDate: '',
      plannedCompletionDate: '',
      actualCompletionDate: '',
    });
    setFollowers([]);
    setDepts([]);
    setOwners([]);
    setFollowerInput('');
    setOwnerInput('');
    setDeptSearch('');
  };

  const handleCreateSubmit = async () => {
    const serialNo = formData.serialNo.trim();
    const normalizedRaiseDate = normalizeManualDateInput(formData.raiseDate);
    const normalizedRequiredCompletionDate = normalizeManualDateInput(formData.requiredCompletionDate);
    const normalizedPlannedCompletionDate = normalizeManualDateInput(formData.plannedCompletionDate);
    const normalizedActualCompletionDate = normalizeManualDateInput(formData.actualCompletionDate);

    if (!serialNo) { showToast('请输入督办字号', 'warning'); return; }
    if (items.some(item => item.serialNo.trim() === serialNo)) {
      showToast(`督办序号「${serialNo}」已存在，不可重复添加`, 'warning');
      return;
    }
    if (followers.length === 0) { showToast('请添加至少一位督办跟进人', 'warning'); return; }
    if (!formData.meetingName) { showToast('请输入提出会议', 'warning'); return; }
    if (!normalizedRaiseDate) { showToast('请输入提出时间', 'warning'); return; }
    if (!isValidManualDateInput(normalizedRaiseDate)) { showToast('提出时间请按年/月/日格式输入，例如：2026/06/03', 'warning'); return; }
    if (normalizedRequiredCompletionDate && !isValidManualDateInput(normalizedRequiredCompletionDate)) { showToast('要求完成日期请按年/月/日格式输入，例如：2026/06/03', 'warning'); return; }
    if (normalizedPlannedCompletionDate && !isValidManualDateInput(normalizedPlannedCompletionDate)) { showToast('计划完成日期请按年/月/日格式输入，例如：2026/06/03', 'warning'); return; }
    if (normalizedActualCompletionDate && !isValidManualDateInput(normalizedActualCompletionDate)) { showToast('实际完成日期请按年/月/日格式输入，例如：2026/06/03', 'warning'); return; }
    if (normalizedRequiredCompletionDate && !isManualDateOnOrAfter(normalizedRequiredCompletionDate, today)) { showToast('要求完成日期不能早于今天', 'warning'); return; }
    if (normalizedPlannedCompletionDate && !isManualDateOnOrAfter(normalizedPlannedCompletionDate, today)) { showToast('计划完成日期不能早于今天', 'warning'); return; }
    if (normalizedActualCompletionDate && !isManualDateOnOrAfter(normalizedActualCompletionDate, today)) { showToast('实际完成日期不能早于今天', 'warning'); return; }
    if (!formData.content) { showToast('请输入督办事项内容', 'warning'); return; }
    if (depts.length === 0) { showToast('请添加至少一个责任部门', 'warning'); return; }
    if (owners.length === 0) { showToast('请添加至少一位责任人', 'warning'); return; }

    setFormData(prev => ({
      ...prev,
      raiseDate: normalizedRaiseDate,
      requiredCompletionDate: normalizedRequiredCompletionDate,
      plannedCompletionDate: normalizedPlannedCompletionDate,
      actualCompletionDate: normalizedActualCompletionDate,
    }));

    setIsSubmitting(true);
    const mainOwner = owners[0];
    const mainFollower = followers[0];
    const newId = Math.random().toString(36).slice(2, 11);
    // 多责任人事项的父级截止日期只代表跟进人填写的要求完成日期；
    // 责任人的计划完成日期必须在各自签收时独立产生，不能把首位责任人的日期传播给全事项。
    const isMultiOwner = owners.length > 1;
    const deadline = normalizedRequiredCompletionDate || (!isMultiOwner ? normalizedPlannedCompletionDate : '');
    const ownerSubTasks = owners.map(owner => ({
      id: `${newId}-${owner.id}`,
      parentItemId: newId,
      title: `${serialNo} - ${owner.name}`,
      deadline,
      status: 'PENDING' as const,
      assigneeId: owner.id,
      assigneeName: owner.name,
      progress: 0,
      requiredCompletionDate: normalizedRequiredCompletionDate,
      plannedCompletionDate: isMultiOwner ? '' : normalizedPlannedCompletionDate,
    }));

    try {
      const itemPayload = {
        id: newId,
        serialNo,
        title: serialNo,
        content: formData.content,
        deadline,
        ownerId: mainOwner.id,
        ownerName: mainOwner.name,
        followerId: mainFollower.id,
        followerName: mainFollower.name,
        meetingSource: formData.meetingName,
        meetingName: formData.meetingName,
        raiseDate: normalizedRaiseDate,
        requiredCompletionDate: normalizedRequiredCompletionDate,
        plannedCompletionDate: isMultiOwner ? '' : normalizedPlannedCompletionDate,
        actualCompletionDate: normalizedActualCompletionDate,
        ownerIds: owners.map(o => o.id),
        ownerNames: owners.map(o => o.name),
        followerIds: followers.map(f => f.id),
        followerNames: followers.map(f => f.name),
        deptNames: depts,
        subTasks: ownerSubTasks,
      };

      // 先同步后端，成功后再写入本地，避免后端失败但前端出现“假数据”。
      await addItemToBackend(itemPayload, pageAuth);

      addItem(itemPayload);

      addActivity({
        type: 'SYSTEM',
        content: `您发起了新督办：【${serialNo}】`,
      });

      addLog({
        userName: currentUser.name,
        userId: currentUser.id,
        action: `发起督办: ${serialNo}`,
        module: '督办事项'
      });

      showToast(`下发成功：督办事项「${serialNo}」已发起`, 'success');
      onClose();
      resetForm();
    } catch (error: unknown) {
      console.error('Failed to create item:', error);
      showToast(getErrorMessage(error), getErrorStatus(error) === 409 ? 'warning' : 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={() => { onClose(); resetForm(); }}
      title="发起新督办"
      footer={
        <div className="flex gap-3 justify-end">
          <button 
            onClick={() => { onClose(); resetForm(); }}
            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
          >
            取消
          </button>
          <button 
            onClick={handleCreateSubmit}
            disabled={isSubmitting}
            className={`px-8 py-2.5 rounded-xl font-bold transition-all shadow-sm flex items-center gap-2 ${
              isSubmitting 
                ? 'bg-blue-400 text-white cursor-not-allowed' 
                : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98] shadow-blue-200'
            }`}
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSubmitting ? '发起中...' : '立即发起'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* 1. 下发账号 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">下发账号</label>
          <div className="w-full px-4 py-2 border border-slate-200 rounded-lg bg-slate-50 text-sm text-slate-700 flex items-center justify-between gap-3">
            <span className="font-semibold">{currentUser.name}</span>
            <span className="text-slate-400 font-mono">{currentUser.username || currentUser.id}</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">系统自动带出当前登录账号，并默认保存，不能手工修改。</p>
        </div>

        {/* 2. 督办字号 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">督办字号 <span className="text-red-500">*</span></label>
          <input 
            type="text"
            placeholder="请输入唯一标识，如：DB-2026-005"
            className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            value={formData.serialNo}
            onChange={(e) => setFormData({ ...formData, serialNo: e.target.value })}
          />
        </div>

        {/* 2. 督办跟进人 */}
        <div ref={followerDropdownRef} className="relative">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">督办跟进人 <span className="text-red-500">*</span></label>
          <p className="text-xs text-slate-400 mb-2">支持多选督办专员，不默认关联当前账号</p>
          <div className="flex gap-2 mb-2">
            <div
              className="relative flex-1 min-h-[42px] px-3 py-1.5 border border-slate-200 rounded-lg focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-all flex flex-wrap items-center gap-1.5 bg-white pr-8"
              onClick={() => setShowFollowerDropdown(true)}
            >
              {followers.map(f => (
                <span key={f.id} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-medium px-2 py-1 rounded-lg">
                  {f.name}
                  <button type="button" onClick={(e) => { e.stopPropagation(); removeFollower(f.id); }} className="text-blue-400 hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
                </span>
              ))}
              <input 
                type="text"
                placeholder={followers.length > 0 ? '继续搜索姓名/员工编号...' : isSyncingOrgUsers ? '正在同步跟进人列表...' : '搜索跟进人姓名/员工编号...'}
                className="min-w-[140px] flex-1 border-none outline-none focus:ring-0 p-0 text-sm"
                value={followerInput}
                disabled={isSyncingOrgUsers}
                onChange={(e) => setFollowerInput(e.target.value)}
                onFocus={() => setShowFollowerDropdown(true)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFollower(); } }}
              />
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
            <button type="button" onClick={addFollower} className="px-3 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-bold hover:bg-blue-100 transition-all shrink-0">添加</button>
          </div>
          {showFollowerDropdown && filteredFollowerCandidates.length > 0 && (
            <div className="absolute z-20 left-0 right-16 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {filteredFollowerCandidates.map(u => (
                <div
                  key={u.id}
                  className="flex items-center justify-between px-3 py-2.5 hover:bg-blue-50 cursor-pointer border-b border-slate-50 last:border-b-0"
                  onMouseDown={(e) => { e.preventDefault(); selectFollower({ id: u.id, name: u.name }); }}
                >
                  <span className="font-medium text-sm text-slate-800">{u.name}</span>
                  <span className="text-xs text-slate-400">{u.username} · {u.role} · {u.deptName}</span>
                </div>
              ))}
            </div>
          )}
          {showFollowerDropdown && filteredFollowerCandidates.length === 0 && (
            <div className="absolute z-20 left-0 right-16 bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-center text-sm text-slate-400">
              暂无匹配的成员
            </div>
          )}
        </div>

        {/* 3. 提出会议 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">提出会议 <span className="text-red-500">*</span></label>
          <input 
            type="text"
            placeholder="如：2026年第4次办公会"
            maxLength={100}
            className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            value={formData.meetingName}
            onChange={(e) => setFormData({ ...formData, meetingName: e.target.value })}
            onPaste={(e) => {
              e.preventDefault();
              const pasted = e.clipboardData.getData('text').replace(/\s+/g, '');
              setFormData({ ...formData, meetingName: pasted.slice(0, 100) });
            }}
          />
        </div>

        {/* 4. 提出时间 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">提出时间 <span className="text-red-500">*</span></label>
          <input 
            type="date"
            className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            value={formData.raiseDate}
            onChange={(e) => setFormData({ ...formData, raiseDate: e.target.value })}
          />
        </div>

        {/* 5. 督办事项 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">督办事项 <span className="text-red-500">*</span></label>
          <textarea 
            rows={4}
            placeholder="请详细描述督办任务的具体内容及要求..."
            className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
            value={formData.content}
            onChange={(e) => setFormData({ ...formData, content: e.target.value })}
          />
        </div>

        {/* 6. 责任部门 */}
        <div ref={deptDropdownRef} className="relative">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">责任部门 <span className="text-red-500">*</span></label>
          <div className="relative">
            <div
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white cursor-pointer flex items-center justify-between gap-2 min-h-[42px]"
              onClick={() => { setShowDeptDropdown(!showDeptDropdown); }}
            >
              <span className={`text-sm ${depts.length > 0 ? 'text-slate-900' : 'text-slate-400'}`}>
                {depts.length > 0 ? `已选 ${depts.length} 个部门` : '点击选择责任部门...'}
              </span>
              <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${showDeptDropdown ? 'rotate-180' : ''}`} />
            </div>
          </div>
          {showDeptDropdown && (
            <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
              <div className="p-2 border-b border-slate-100">
                <input
                  autoFocus
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  placeholder="搜索部门..."
                  value={deptSearch}
                  onChange={(e) => setDeptSearch(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <div className="max-h-56 overflow-y-auto">
                {filteredDepts.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-slate-400 text-center">无匹配部门</div>
                ) : (
                  filteredDepts.map(d => (
                    <label
                      key={d.value}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50 cursor-pointer transition-colors text-sm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={depts.includes(d.label)}
                        onChange={() => {
                          if (depts.includes(d.label)) {
                            setDepts(prev => prev.filter(x => x !== d.label));
                          } else {
                            setDepts(prev => [...prev, d.label]);
                          }
                        }}
                        className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded"
                      />
                      <span className="text-slate-700">{d.label}</span>
                    </label>
                  ))
                )}
              </div>
              {depts.length > 0 && (
                <div className="px-4 py-2 border-t border-slate-100 flex justify-between items-center bg-slate-50">
                  <span className="text-xs text-slate-500">已选 {depts.length} 个</span>
                  <button
                    type="button"
                    className="text-xs font-bold text-blue-600 hover:text-blue-700"
                    onClick={(e) => { e.stopPropagation(); setShowDeptDropdown(false); }}
                  >
                    确定
                  </button>
                </div>
              )}
            </div>
          )}
          {depts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {depts.map(d => (
                <span key={d} className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 text-xs font-medium px-2 py-1 rounded-lg">
                  {d}
                  <button type="button" onClick={() => removeDept(d)} className="text-purple-400 hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 7. 责任人 */}
        <div ref={ownerDropdownRef} className="relative">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">责任人 <span className="text-red-500">*</span></label>
          <div className="flex gap-2 mb-2">
            <div
              className="relative flex-1 min-h-[42px] px-3 py-1.5 border border-slate-200 rounded-lg focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-all flex flex-wrap items-center gap-1.5 bg-white pr-8"
              onClick={() => setShowOwnerDropdown(true)}
            >
              {owners.map(o => (
                <span key={o.id} className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-medium px-2 py-1 rounded-lg">
                  {o.name}
                  <button type="button" onClick={(e) => { e.stopPropagation(); removeOwner(o.id); }} className="text-green-400 hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
                </span>
              ))}
              <input 
                type="text"
                placeholder={owners.length > 0 ? '继续搜索姓名/员工编号...' : '搜索责任人姓名/员工编号...'}
                className="min-w-[140px] flex-1 border-none outline-none focus:ring-0 p-0 text-sm"
                value={ownerInput}
                onChange={(e) => setOwnerInput(e.target.value)}
                onFocus={() => setShowOwnerDropdown(true)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOwner(); } }}
              />
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
            <button type="button" onClick={addOwner} className="px-3 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-bold hover:bg-blue-100 transition-all shrink-0">添加</button>
          </div>
          {showOwnerDropdown && filteredOwnerCandidates.length > 0 && (
            <div className="absolute z-20 left-0 right-16 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {filteredOwnerCandidates.map(u => (
                <div
                  key={u.id}
                  className="flex items-center justify-between px-3 py-2.5 hover:bg-blue-50 cursor-pointer border-b border-slate-50 last:border-b-0"
                  onMouseDown={(e) => { e.preventDefault(); selectOwner({ id: u.id, name: u.name }); }}
                >
                  <span className="font-medium text-sm text-slate-800">{u.name}</span>
                  <span className="text-xs text-slate-400">{u.username} · {u.role} · {u.deptName}</span>
                </div>
              ))}
            </div>
          )}
          {showOwnerDropdown && filteredOwnerCandidates.length === 0 && (
            <div className="absolute z-20 left-0 right-16 bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-center text-sm text-slate-400">
              {isSyncingOrgUsers ? '正在同步成员列表...' : '暂无匹配的成员'}
            </div>
          )}
        </div>

        {/* 8. 日期 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">要求完成日期 <span className="text-slate-400 font-normal text-xs">(非必填)</span></label>
            <input 
              type="date"
              min={today}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={formData.requiredCompletionDate}
              onChange={(e) => setFormData({ ...formData, requiredCompletionDate: e.target.value })}
            />
            <p className="mt-1 text-xs text-slate-400">请选择 {today} 之后的日期</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">计划完成日期 <span className="text-slate-400 font-normal text-xs">(非必填)</span></label>
            <input 
              type="date"
              min={today}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={formData.plannedCompletionDate}
              onChange={(e) => setFormData({ ...formData, plannedCompletionDate: e.target.value })}
            />
            <p className="mt-1 text-xs text-slate-400">责任人签收时可更新</p>
          </div>
        </div>

        {/* 9. 实际完成日期 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">实际完成日期 <span className="text-slate-400 font-normal text-xs">(非必填)</span></label>
          <input 
            type="date"
            min={today}
            className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            value={formData.actualCompletionDate}
            onChange={(e) => setFormData({ ...formData, actualCompletionDate: e.target.value })}
          />
          <p className="mt-1 text-xs text-slate-400">跟进人完成督办操作时可更新</p>
        </div>
      </div>
    </Drawer>
  );
};
