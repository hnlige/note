import React, { useState } from 'react';
import { ModalShell, FieldLabel, CharTextarea, AttachmentUpload } from '../ModalShell';

interface CompleteModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: { note: string; files: File[] }) => Promise<void>;
}

export const CompleteModal: React.FC<CompleteModalProps> = ({ open, onClose, onSubmit }) => {
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!note.trim() || note.length < 5) return;
    setSubmitting(true);
    try {
      await onSubmit({ note: note.trim(), files: [...files] });
      setNote('');
      setFiles([]);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title="申请完成"
      open={open}
      onClose={() => {
        setNote('');
        setFiles([]);
        onClose();
      }}
      onSubmit={handleSubmit}
      submitLabel="提交申请"
      submitDisabled={!note.trim() || note.length < 5 || submitting}
      submitting={submitting}
      hasContent={note.length > 0 || files.length > 0}
    >
      <div className="mb-5">
        <FieldLabel required hint="5-1000字">完成说明</FieldLabel>
        <CharTextarea
          value={note}
          onChange={setNote}
          placeholder="请输入完成说明..."
          min={5}
          max={1000}
          rows={5}
        />
      </div>

      <div className="mb-5">
        <FieldLabel hint="可选，单文件≤50MB">上传证明材料</FieldLabel>
        <AttachmentUpload
          files={files.map(f => ({ name: f.name, size: f.size }))}
          onPick={(list) => list && setFiles(prev => [...prev, ...Array.from(list)])}
          onRemove={(i) => setFiles(prev => prev.filter((_, idx) => idx !== i))}
        />
      </div>

      <div className="bg-blue-50 rounded-xl px-4 py-3">
        <p className="text-xs text-blue-700 font-medium leading-relaxed">
          💡 提交后，将等待跟进人审批，审批结果将通过消息通知您。
        </p>
      </div>
    </ModalShell>
  );
};
