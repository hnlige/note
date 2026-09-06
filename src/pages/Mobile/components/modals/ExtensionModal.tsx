import React, { useEffect, useState } from 'react';
import { ModalShell, FieldLabel, CharTextarea } from '../ModalShell';
import type { SupervisionItem } from '../../../../types';
import { isValidManualDateInput, todayDateString } from '../../../../lib/item-format';
import { MobileDateWheelPicker } from './MobileDateWheelPicker';
import {
  getTomorrowDate,
  isExtensionDateAllowed,
  isExtensionReasonValid,
  toDateInputValue,
  toManualDateValue,
} from './extension-modal-helpers';

interface ExtensionModalProps {
  open: boolean;
  item: SupervisionItem | null;
  /** 当前责任人的日期，避免多责任人时使用父事项日期作为上下文。 */
  deadline?: string;
  onClose: () => void;
  onSubmit: (payload: { newDeadline: string; reason: string }) => Promise<void>;
}

export const ExtensionModal: React.FC<ExtensionModalProps> = ({ open, item, deadline, onClose, onSubmit }) => {
  const [newDeadline, setNewDeadline] = useState(() => getTomorrowDate());
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setNewDeadline(getTomorrowDate());
      setReason('');
    }
  }, [open]);

  const effectiveDeadline = deadline || item?.deadline;
  const manualDeadline = toManualDateValue(newDeadline);
  const dateIsAllowed = isExtensionDateAllowed(newDeadline);
  const reasonIsValid = isExtensionReasonValid(reason);

  const handleSubmit = async () => {
    if (!dateIsAllowed || !reasonIsValid) return;
    setSubmitting(true);
    try {
      await onSubmit({ newDeadline: manualDeadline, reason: reason.trim() });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const overdueDays = (() => {
    const originalDeadline = toManualDateValue(toDateInputValue(effectiveDeadline));
    if (!isValidManualDateInput(originalDeadline)) return 0;
    const [year, month, day] = originalDeadline.split('/').map(Number);
    const now = new Date();
    const due = new Date(year, month - 1, day);
    now.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    return Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
  })();

  return (
    <ModalShell
      title="申请延期"
      open={open}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel="提交申请"
      submitDisabled={!dateIsAllowed || !reasonIsValid || submitting}
      submitting={submitting}
      hasContent={newDeadline.length > 0 || reason.length > 0}
    >
      {/* 原完成日期 */}
      <div className="mb-5">
        <FieldLabel>原完成日期</FieldLabel>
        <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm">
          <span className="text-slate-600">{toDateInputValue(effectiveDeadline) || toDateInputValue(item?.requiredCompletionDate) || '-'}</span>
          {overdueDays > 0 && (
            <span className="ml-2 text-red-500 font-bold text-xs">已超期 {overdueDays} 天</span>
          )}
        </div>
      </div>

      {/* 新完成计划日期 */}
      <div className="mb-5">
        <FieldLabel required>新完成计划日期</FieldLabel>
        <MobileDateWheelPicker
          value={newDeadline}
          minDate={todayDateString().replace(/\//g, '-')}
          onChange={setNewDeadline}
        />
        {!dateIsAllowed && newDeadline && (
          <p className="text-[10px] text-red-500 mt-1">新完成计划日期必须晚于今天</p>
        )}
      </div>

      {/* 延期原因 */}
      <div className="mb-4">
        <FieldLabel required hint="5-500字">延期原因</FieldLabel>
        <CharTextarea
          value={reason}
          onChange={setReason}
          placeholder="请输入延期原因..."
          min={5}
          max={500}
          rows={4}
        />
        <div className="mt-2">
          <p className="text-[10px] text-slate-400 font-bold mb-1.5">💡 常用原因：</p>
          {['任务复杂，需更多时间', '等待第三方反馈', '资源冲突，需协调'].map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className="block text-left text-xs text-blue-600 py-1"
            >
              · {r}
            </button>
          ))}
        </div>
      </div>
    </ModalShell>
  );
};
