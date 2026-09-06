import React, { useState } from 'react';
import { ModalShell, FieldLabel, CharTextarea, AttachmentUpload } from '../ModalShell';
import type { User } from '../../../../types';

interface FeedbackModalProps {
  open: boolean;
  currentUser: User;
  onClose: () => void;
  onSubmit: (payload: {
    content: string;
    files: File[];
  }) => Promise<void>;
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ open, onClose, onSubmit }) => {
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setContent('');
    setFiles([]);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!content.trim() || content.length < 2) return;
    setSubmitting(true);
    try {
      // 附件由父组件在 onSubmit 内调用 api.attachments.upload 后再写时间轴
      await onSubmit({ content: content.trim(), files: [...files] });
      reset();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const hasContent = content.length > 0 || files.length > 0;

  return (
    <ModalShell
      title="反馈进度"
      open={open}
      onClose={handleClose}
      onSubmit={handleSubmit}
      submitLabel="提交反馈"
      submitDisabled={!content.trim() || content.length < 2 || submitting}
      submitting={submitting}
      hasContent={hasContent}
    >
      {/* 反馈内容 */}
      <div className="mb-5">
        <FieldLabel required hint="2-1000字">反馈内容</FieldLabel>
        <CharTextarea
          value={content}
          onChange={setContent}
          placeholder="请输入反馈内容..."
          min={2}
          max={1000}
          rows={5}
        />
      </div>

      {/* 上传附件 */}
      <div>
        <FieldLabel hint="可选，单文件≤10MB">上传附件</FieldLabel>
        <AttachmentUpload
          files={files.map(f => ({ name: f.name, size: f.size }))}
          onPick={(list) => list && setFiles(prev => [...prev, ...Array.from(list)])}
          onRemove={(i) => setFiles(prev => prev.filter((_, idx) => idx !== i))}
        />
      </div>
    </ModalShell>
  );
};
