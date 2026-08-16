import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MainLayout } from '../../components/Layout/MainLayout';
import { useStore } from '../../store/useStore';
import { useToast } from '../../components/Common/Toast';
import { api } from '../../lib/api';
import {
  ArrowRightLeft,
  UserMinus,
  UserPlus,
  Search,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
} from 'lucide-react';

type Scope = 'OWNER' | 'FOLLOWER' | 'ALL';

interface PickerUser {
  id: string;
  name: string;
  username: string;
  status: string;
  deptName?: string;
}

const SCOPE_OPTIONS: { value: Scope; label: string; desc: string }[] = [
  { value: 'OWNER', label: '仅责任人', desc: '转交其作为责任人的督办事项' },
  { value: 'FOLLOWER', label: '仅跟进人', desc: '转交其作为跟进人的督办事项' },
  { value: 'ALL', label: '全部', desc: '责任人 + 跟进人一并转交（含已办结）' },
];

function getDeptName(deptId: string | undefined, nodes: any[]): string {
  if (!deptId || !Array.isArray(nodes)) return '';
  for (const node of nodes) {
    if (node.id === deptId) return node.name;
    if (node.children) {
      const found = getDeptName(deptId, node.children);
      if (found) return found;
    }
  }
  return '';
}

const UserPicker: React.FC<{
  label: string;
  users: PickerUser[];
  value: PickerUser | null;
  onChange: (u: PickerUser) => void;
  placeholder: string;
  excludeId?: string;
  icon: React.ReactNode;
}> = ({ label, users, value, onChange, placeholder, excludeId, icon }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () =>
      users.filter(
        (u) =>
          u.id !== excludeId &&
          (!search.trim() ||
            u.name.includes(search.trim()) ||
            u.username.includes(search.trim())),
      ),
    [users, excludeId, search],
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      <div
        className="w-full px-4 py-2.5 border border-slate-200 rounded-lg bg-white cursor-pointer flex items-center justify-between gap-2 hover:border-slate-300 transition-colors"
        onClick={() => {
          setOpen(!open);
          setSearch('');
        }}
      >
        <span className={`text-sm flex items-center gap-2 truncate ${value ? 'text-slate-900' : 'text-slate-400'}`}>
          {icon}
          {value ? (
            <>
              {value.name}
              <span className="text-xs text-slate-400">（{value.username}）</span>
              {value.deptName ? <span className="text-xs text-slate-400">· {value.deptName}</span> : null}
              {value.status !== 'ACTIVE' ? (
                <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">已停用</span>
              ) : null}
            </>
          ) : (
            placeholder
          )}
        </span>
        <svg className="w-4 h-4 text-slate-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 rounded">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索姓名 / 账号"
                className="bg-transparent text-sm outline-none w-full"
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-400">无匹配人员</div>
            ) : (
              filtered.map((u) => (
                <div
                  key={u.id}
                  className="px-4 py-2.5 text-sm hover:bg-blue-50 cursor-pointer flex items-center gap-2"
                  onClick={() => {
                    onChange(u);
                    setOpen(false);
                  }}
                >
                  <span className="text-slate-900">{u.name}</span>
                  <span className="text-xs text-slate-400">（{u.username}）</span>
                  {u.deptName ? <span className="text-xs text-slate-400">· {u.deptName}</span> : null}
                  {u.status !== 'ACTIVE' ? (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">已停用</span>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const ReassignSupervision: React.FC = () => {
  const { orgUsers, departments, currentUser } = useStore();
  const { showToast } = useToast();

  const [fromUser, setFromUser] = useState<PickerUser | null>(null);
  const [toUser, setToUser] = useState<PickerUser | null>(null);
  const [scope, setScope] = useState<Scope>('ALL');
  const [disableSource, setDisableSource] = useState(true);

  const [preview, setPreview] = useState<{ count: number; conflicts: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const usersWithDept = useMemo<PickerUser[]>(
    () =>
      orgUsers.map((u: any) => ({
        id: u.id,
        name: u.name,
        username: u.username,
        status: u.status || 'ACTIVE',
        deptName: getDeptName(u.deptId, departments),
      })),
    [orgUsers, departments],
  );

  // 来源人：含已停用（离职/调岗人员本身可能已被停用）
  const fromCandidates = usersWithDept;
  // 目标人：仅活跃账号（接收人必须可登录）
  const toCandidates = useMemo(() => usersWithDept.filter((u) => u.status === 'ACTIVE'), [usersWithDept]);

  const scopeLabel = SCOPE_OPTIONS.find((s) => s.value === scope)?.label || '';

  const runPreview = useCallback(async () => {
    if (!fromUser || !toUser || fromUser.id === toUser.id) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    try {
      const data = await api.reassign.preview({ fromUserId: fromUser.id, toUserId: toUser.id, scope });
      setPreview(data);
    } catch (err: any) {
      setPreview(null);
      showToast(err?.message || '预览失败', 'error');
    } finally {
      setPreviewing(false);
    }
  }, [fromUser, toUser, scope, showToast]);

  // 选择变化后自动刷新预览
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (fromUser && toUser && fromUser.id !== toUser.id) {
        if (!cancelled) runPreview();
      } else {
        setPreview(null);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [fromUser, toUser, scope, runPreview]);

  const canSubmit = Boolean(fromUser && toUser && fromUser.id !== toUser.id && preview && preview.count > 0 && preview.conflicts.length === 0);

  const handleExecute = async () => {
    if (!fromUser || !toUser) return;
    setSubmitting(true);
    try {
      const res = await api.reassign.execute({
        fromUserId: fromUser.id,
        toUserId: toUser.id,
        scope,
        disableSource,
      });
      setShowConfirm(false);
      showToast(
        `转交完成：共 ${res.reassigned} 条督办事项已移交${res.disabledSource ? `，${fromUser.name} 账号已停用` : ''}`,
        'success',
      );
      // 重置选择，等待用户重新操作
      setFromUser(null);
      setToUser(null);
      setPreview(null);
    } catch (err: any) {
      // 后端整体拦截（如冲突）会抛错，提示但不关闭确认框以便用户修正
      showToast(err?.message || '督办转交失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MainLayout>
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* 页头 */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-slate-900">
            <ArrowRightLeft className="w-6 h-6 text-blue-600" />
            <h1 className="text-xl font-bold">员工督办转交</h1>
          </div>
          <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">
            仅超级管理员可操作。将离职 / 调岗人员的督办事项批量转交给另一名员工。
            <span className="text-slate-700 font-medium">原状态、反馈、附件、催办与审核记录全部保留</span>
            ，仅替换责任 / 跟进人身份，并全程留痕。
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
          {/* 来源 / 目标 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <UserPicker
              label="转交来源人"
              users={fromCandidates}
              value={fromUser}
              onChange={setFromUser}
              placeholder="选择离职 / 调岗人员"
              excludeId={toUser?.id}
              icon={<UserMinus className="w-4 h-4 text-slate-400" />}
            />
            <UserPicker
              label="转交目标人（须为活跃账号）"
              users={toCandidates}
              value={toUser}
              onChange={setToUser}
              placeholder="选择接收人"
              excludeId={fromUser?.id}
              icon={<UserPlus className="w-4 h-4 text-slate-400" />}
            />
          </div>

          {/* 范围 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">转交范围</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SCOPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setScope(opt.value)}
                  className={`text-left px-4 py-3 rounded-lg border transition-all ${
                    scope === opt.value
                      ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500/30'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className={`text-sm font-medium ${scope === opt.value ? 'text-blue-700' : 'text-slate-800'}`}>
                    {opt.label}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 预览卡片 */}
          <div>
            {!fromUser || !toUser ? (
              <div className="flex items-center gap-2 text-sm text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-4 py-3">
                <Info className="w-4 h-4" />
                请先选择来源人与目标人，将自动统计可转交数量。
              </div>
            ) : fromUser.id === toUser.id ? (
              <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
                <AlertTriangle className="w-4 h-4" />
                来源人与目标人不能相同。
              </div>
            ) : previewing ? (
              <div className="text-sm text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-4 py-3">
                正在统计可转交数量…
              </div>
            ) : preview && preview.conflicts.length > 0 ? (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">已阻断：目标人已是以下事项的{scope === 'FOLLOWER' ? '跟进人' : scope === 'OWNER' ? '责任人' : '责任人或跟进人'}</div>
                  <div className="mt-1 text-red-600">
                    为保证原状态不变，整体移交已拦截。冲突事项：{preview.conflicts.slice(0, 10).join('、')}
                    {preview.conflicts.length > 10 ? ` 等共 ${preview.conflicts.length} 条` : ''}
                  </div>
                </div>
              </div>
            ) : preview && preview.count > 0 ? (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-4 py-3">
                <CheckCircle2 className="w-4 h-4" />
                将移交 <span className="font-bold">{preview.count}</span> 条督办事项（范围：{scopeLabel}），
                原状态与业务数据全部保留。
              </div>
            ) : preview && preview.count === 0 ? (
              <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-4 py-3">
                <Info className="w-4 h-4" />
                该人员当前无匹配的督办事项。
              </div>
            ) : null}
          </div>

          {/* 停用来源账号 */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={disableSource}
              onChange={(e) => setDisableSource(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/30"
            />
            <span className="text-sm text-slate-700">
              移交同时停用来源人账号
              <span className="text-slate-400 ml-1">（离职场景建议勾选，停用的账号将无法登录）</span>
            </span>
          </label>

          {/* 提交 */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <span className="text-xs text-slate-400">
              操作人：{currentUser?.name || '—'} · 全程记录于事项时间线与系统日志
            </span>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => setShowConfirm(true)}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                canSubmit
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              确认转交
            </button>
          </div>
        </div>
      </div>

      {/* 确认弹窗 */}
      {showConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900">确认督办转交</h3>
              <button onClick={() => setShowConfirm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <UserMinus className="w-4 h-4 text-slate-400" />
                <span>
                  来源：<span className="font-medium text-slate-900">{fromUser?.name}</span>
                </span>
                <ArrowRightLeft className="w-4 h-4 text-blue-500" />
                <span>
                  目标：<span className="font-medium text-slate-900">{toUser?.name}</span>
                </span>
              </div>
              <div>
                范围：<span className="font-medium text-slate-900">{scopeLabel}</span> · 将移交{' '}
                <span className="font-bold text-blue-600">{preview?.count ?? 0}</span> 条督办事项
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-amber-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>原状态、反馈、附件、催办与审核记录全部保留，仅替换责任 / 跟进人身份。该操作不可撤销。</span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={disableSource}
                  onChange={(e) => setDisableSource(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/30"
                />
                <span>同时停用来源人账号（{fromUser?.name}）</span>
              </label>
            </div>
            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100"
              >
                取消
              </button>
              <button
                onClick={handleExecute}
                disabled={submitting}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {submitting ? '转交中…' : '确认转交'}
              </button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
};

export default ReassignSupervision;
