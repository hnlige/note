import React, { useEffect, useState } from 'react';
import { ModalShell, CharTextarea, FieldLabel } from '../ModalShell';

type ApprovalMode = 'approve' | 'reject';

interface ApprovalModalProps {
  open: boolean;
  mode: ApprovalMode;
  finalApproval?: boolean;
  onClose: () => void;
  onSubmit: (reason?: string) => Promise<void>;
}

export const ApprovalModal: React.FC<ApprovalModalProps> = ({
  open,
  mode,
  finalApproval = false,
  onClose,
  onSubmit,
}) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isReject = mode === 'reject';

  useEffect(() => {
    if (!open) {
      setReason('');
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (isReject && !reason.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(isReject ? reason.trim() : undefined);
      setReason('');
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={isReject ? '驳回完成申请' : finalApproval ? '终审确认' : '审批确认'}
      open={open}
      onClose={() => {
        setReason('');
        onClose();
      }}
      onSubmit={handleSubmit}
      submitLabel={isReject ? '确认驳回' : finalApproval ? '确认终审通过' : '确认审批通过'}
      submitDisabled={submitting || (isReject && !reason.trim())}
      submitting={submitting}
      hasContent={Boolean(reason)}
    >
      {isReject ? (
        <div>
          <FieldLabel required hint="请说明未满足的完成条件">驳回原因</FieldLabel>
          <CharTextarea
            value={reason}
            onChange={setReason}
            placeholder="请输入驳回原因..."
            min={1}
            max={1000}
            rows={5}
          />
        </div>
      ) : (
        <div className="bg-blue-50 rounded-xl px-4 py-3">
          <p className="text-sm text-blue-700 font-medium leading-relaxed">
            {finalApproval
              ? '确认终审通过后，已通过跟进人本级审批的责任人子任务将正常完成。'
              : '确认通过后，完成申请将提交跟进人的直属上级进行终审。'}
          </p>
        </div>
      )}
    </ModalShell>
  );
};
