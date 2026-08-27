import React, { useEffect, useState } from 'react';
import { ModalShell, FieldLabel } from '../ModalShell';

interface SignModalProps {
  open: boolean;
  /** 是否需要填写计划完成日期 */
  requirePlannedDate?: boolean;
  /** 跟进人下发的要求完成日期；存在时签收统一采用该日期 */
  requiredCompletionDate?: string;
  onClose: () => void;
  onSign: (plannedDate?: string) => Promise<void>;
  /** 本地校验未通过时的提示回调（如缺计划完成日期） */
  onError?: (message: string) => void;
}

export const SignModal: React.FC<SignModalProps> = ({
  open,
  requirePlannedDate = false,
  requiredCompletionDate = '',
  onClose,
  onSign,
  onError,
}) => {
  const [plannedDate, setPlannedDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setPlannedDate(requiredCompletionDate);
  }, [open, requiredCompletionDate]);

  const reset = () => setPlannedDate(requiredCompletionDate);
  const signIncomplete = requirePlannedDate && !plannedDate;

  const handleSubmit = async () => {
    if (signIncomplete) {
      onError?.('请先选择计划完成日期后再签收');
      return;
    }
    setSubmitting(true);
    try {
      await onSign(plannedDate || undefined);
      reset();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title="签收事项"
      open={open}
      onClose={() => { reset(); onClose(); }}
      onSubmit={handleSubmit}
      submitLabel="确认签收"
      submitDisabled={submitting}
      submitting={submitting}
      hasContent={plannedDate.length > 0}
    >
      {requirePlannedDate ? (
        <div>
          <FieldLabel required>计划完成日期</FieldLabel>
          <input
            type="date"
            value={plannedDate}
            onChange={(e) => setPlannedDate(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <p className="text-[10px] text-slate-400 mt-1">该督办下发时未填写要求完成日期，请填写您的计划完成日期后再签收。</p>
        </div>
      ) : (
        <div className="bg-blue-50 rounded-xl px-4 py-3">
          <p className="text-sm text-blue-700 font-medium leading-relaxed">
            {requiredCompletionDate
              ? `已按要求完成日期 ${requiredCompletionDate} 签收，签收后事项将进入“执行中”状态。`
              : '签收后该事项将进入“执行中”状态，您可开始提交进度反馈。'}
          </p>
        </div>
      )}
    </ModalShell>
  );
};
