import React, { useEffect, useMemo, useState } from 'react';
import { ModalShell, FieldLabel, CharTextarea } from '../ModalShell';
import type { SupervisionItem, SubTask } from '../../../../types';

interface UrgeModalProps {
  open: boolean;
  item: SupervisionItem | null;
  activeUsers: { id: string; name: string; status?: string }[];
  onClose: () => void;
  onError?: (message: string) => void;
  onSubmit: (payload: { receiverIds: string[]; content: string }) => Promise<void>;
}

const PRESET_SCRIPTS = [
  '请加快进度，按时完成',
  '即将超期，请尽快反馈',
  '已超期，请立即处理',
];

/** 提取事项全部责任人列表（用于催办对象多选） */
export function getItemOwners(item: SupervisionItem, activeUsers: { id: string; name: string; status?: string }[]): { id: string; name: string; subTask?: SubTask }[] {
  const ids = item.ownerIds || [];
  const names = item.ownerNames || [];
  const count = Math.max(ids.length, names.length, item.ownerId || item.ownerName ? 1 : 0);
  return Array.from({ length: count }, (_, i) => {
    const name = names[i] || (i === 0 ? item.ownerName : '') || '';
    const directId = ids[i] || (i === 0 ? item.ownerId : '') || '';
    const matchedUser = directId ? undefined : activeUsers.find(user => user.name === name);
    const id = directId || matchedUser?.id || '';
    return {
      id,
      name: name || matchedUser?.name || id,
      subTask: item.subTasks?.find(t => t.assigneeId === id || t.assigneeName === name),
    };
  }).filter(o => o.id || o.name);
}

export const UrgeModal: React.FC<UrgeModalProps> = ({ open, item, activeUsers, onClose, onError, onSubmit }) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const owners = useMemo(() => item ? getItemOwners(item, activeUsers) : [], [item, activeUsers]);

  useEffect(() => {
    if (open && item) {
      // 默认全选责任人
      setSelectedIds(new Set(owners.map(o => o.id || o.name)));
      setContent(PRESET_SCRIPTS[0]);
    }
  }, [open, item, activeUsers, owners]);

  const toggle = (key: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!content.trim() || selectedIds.size === 0) return;
    setSubmitting(true);
    try {
      const selectedOwners = owners.filter(o => selectedIds.has(o.id || o.name));
      const missingIds = selectedOwners.filter(o => !o.id).map(o => o.name);
      if (missingIds.length > 0) {
        throw new Error(`无法催办（缺少账号 ID）：${missingIds.join('、')}`);
      }
      const receiverIds = selectedOwners.map(o => o.id).filter(Boolean);
      if (receiverIds.length === 0) throw new Error('请选择有效的催办接收人');
      await onSubmit({ receiverIds, content: content.trim() });
      onClose();
    } catch (err: any) {
      onError?.(err?.message || '催办失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title="发送催办"
      open={open}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel="发送催办"
      submitDisabled={!content.trim() || selectedIds.size === 0 || submitting}
      submitting={submitting}
      hasContent={content.length > 0}
    >
      {/* 催办对象 */}
      <div className="mb-5">
        <FieldLabel required>催办对象</FieldLabel>
        <div className="space-y-1">
          {owners.map(o => {
            const key = o.id || o.name;
            const checked = selectedIds.has(key);
            return (
              <button
                key={key}
                onClick={() => toggle(key)}
                className="w-full flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-slate-50 transition-all"
              >
                <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                  checked ? 'bg-blue-600 border-blue-600' : 'border-slate-300'
                }`}>
                  {checked && <span className="text-white text-xs">✓</span>}
                </div>
                <span className="text-sm text-slate-700 font-medium">{o.name}</span>
                <span className="text-[10px] text-slate-400">（责任人）</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 催办内容 */}
      <div className="mb-4">
        <FieldLabel required>催办内容</FieldLabel>
        <CharTextarea
          value={content}
          onChange={setContent}
          placeholder="请输入催办内容..."
          max={200}
          rows={4}
        />
        <div className="mt-2">
          <p className="text-[10px] text-slate-400 font-bold mb-1.5">💡 预设话术：</p>
          {PRESET_SCRIPTS.map(s => (
            <button key={s} onClick={() => setContent(s)} className="block text-left text-xs text-blue-600 py-1">
              · {s}
            </button>
          ))}
        </div>
      </div>
    </ModalShell>
  );
};
