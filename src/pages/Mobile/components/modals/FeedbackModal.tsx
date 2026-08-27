import React, { useState } from 'react';
import { ModalShell, FieldLabel, CharTextarea, AttachmentUpload } from '../ModalShell';
import type { User } from '../../../../types';

interface FeedbackModalProps {
  open: boolean;
  currentUser: User;
  onClose: () => void;
  onSubmit: (payload: {
    content: string;
    progress: 'NOT_START' | 'IN_PROGRESS' | 'COMPLETED';
    files: File[];
  }) => Promise<void>;
}

const PRESET_PROGRESS = [
  { value: 'NOT_START', label: '未开始' },
  { value: 'IN_PROGRESS', label: '推进中' },
  { value: 'COMPLETED', label: '已完成' },
] as const;

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ open, onClose, onSubmit }) => {
  const [progress, setProgress] = useState<'NOT_START' | 'IN_PROGRESS' | 'COMPLETED'>('IN_PROGRESS');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setProgress('IN_PROGRESS');
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
      await onSubmit({ content: content.trim(), progress, files: [...files] });
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
      {/* 当前进度 */}
      <div className="mb-5">
        <FieldLabel required>当前进度</FieldLabel>
        <div className="flex gap-2">
          {PRESET_PROGRESS.map((p) => (
            <button
              key={p.value}
              onClick={() => setProgress(p.value)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                progress === p.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-500 border-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

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
        <FieldLabel hint="可选，单文件≤25MB">上传附件</FieldLabel>
        <AttachmentUpload
          files={files.map(f => ({ name: f.name, size: f.size }))}
          onPick={(list) => list && setFiles(prev => [...prev, ...Array.from(list)])}
          onRemove={(i) => setFiles(prev => prev.filter((_, idx) => idx !== i))}
        />
      </div>
    </ModalShell>
  );
};
