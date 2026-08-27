import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface ModalShellProps {
  title: string;
  open: boolean;
  onClose: () => void;
  onSubmit?: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
  submitting?: boolean;
  children: React.ReactNode;
  /** 有填写内容时关闭需二次确认 */
  hasContent?: boolean;
}

/**
 * 半屏 Modal 外壳（对应 UI 规范 4.3 节）：
 * 从底部滑入、覆盖约 70% 视口、拖拽条、标题栏、内容滚动、主按钮固定底部。
 */
export const ModalShell: React.FC<ModalShellProps> = ({
  title,
  open,
  onClose,
  onSubmit,
  submitLabel = '提交',
  submitDisabled = false,
  submitting = false,
  children,
  hasContent = false,
}) => {
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  const handleClose = () => {
    if (hasContent && !confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    setConfirmCancel(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/45 transition-opacity"
        onClick={handleClose}
      />
      {/* Modal 主体 */}
      <div className="relative w-full max-w-md bg-white rounded-t-2xl flex flex-col" style={{ maxHeight: '70vh', animation: 'mobileModalSlideUp 250ms ease-out' }}>
        <style>{`@keyframes mobileModalSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
        {/* 拖拽条 */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-9 h-1 rounded-full bg-slate-200" />
        </div>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-800">{title}</h3>
          <button onClick={handleClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            {confirmCancel ? <X className="w-5 h-5" /> : <span className="text-sm">取消</span>}
          </button>
        </div>

        {/* 二次确认提示 */}
        {confirmCancel && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
            <span className="text-xs text-amber-700 font-medium">是否放弃已填写内容？</span>
            <div className="flex gap-2">
              <button onClick={() => setConfirmCancel(false)} className="text-xs text-slate-500 font-bold px-2 py-1">继续编辑</button>
              <button onClick={handleClose} className="text-xs text-amber-600 font-bold px-2 py-1">放弃</button>
            </div>
          </div>
        )}

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {children}
        </div>

        {/* 底部主按钮 */}
        {onSubmit && (
          <div className="px-4 pb-4 pt-2 border-t border-slate-100" style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom))' }}>
            <button
              onClick={onSubmit}
              disabled={submitDisabled || submitting}
              className="w-full h-11 bg-blue-600 text-white text-base font-bold rounded-xl hover:bg-blue-700 transition-all active:scale-[0.98] disabled:bg-blue-200 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              {submitting ? '提交中...' : submitLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/** 表单字段标签 */
export const FieldLabel: React.FC<{ children: React.ReactNode; required?: boolean; hint?: string }> = ({ children, required, hint }) => (
  <div className="mb-2 flex items-center gap-1">
    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{children}</span>
    {required && <span className="text-red-500 text-xs">*</span>}
    {hint && <span className="text-[10px] text-slate-400 font-normal normal-case">{hint}</span>}
  </div>
);

/** 附件上传区 */
interface AttachmentUploadProps {
  files: { name: string; size: number }[];
  onPick: (files: FileList | null) => void;
  onRemove: (index: number) => void;
  accept?: string;
}

export const AttachmentUpload: React.FC<AttachmentUploadProps> = ({ files, onPick, onRemove, accept }) => (
  <div>
    <div className="flex gap-2">
      <label className="flex-1 flex flex-col items-center gap-1 py-3 border border-dashed border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-all">
        <span className="text-xs text-slate-500">📷 拍照/图片</span>
        <input type="file" accept={accept || 'image/*'} capture="environment" multiple className="hidden" onChange={(e) => onPick(e.target.files)} />
      </label>
      <label className="flex-1 flex flex-col items-center gap-1 py-3 border border-dashed border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-all">
        <span className="text-xs text-slate-500">📄 文件</span>
        <input type="file" multiple className="hidden" onChange={(e) => onPick(e.target.files)} />
      </label>
    </div>
    {files.length > 0 && (
      <div className="mt-2 space-y-1.5">
        {files.map((f, i) => (
          <div key={i} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
            <span className="text-xs text-slate-600 truncate flex-1">{f.name}</span>
            <span className="text-[10px] text-slate-400 ml-2">{(f.size / 1024 / 1024).toFixed(1)}MB</span>
            <button onClick={() => onRemove(i)} className="text-red-400 hover:text-red-600 text-xs ml-2 font-bold">删除</button>
          </div>
        ))}
      </div>
    )}
  </div>
);

/** 字数统计 textarea */
interface CharTextareaProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: number;
  max: number;
  rows?: number;
}

export const CharTextarea: React.FC<CharTextareaProps> = ({ value, onChange, placeholder, min = 0, max, rows = 4 }) => {
  const over = value.length > max;
  const underMin = min > 0 && value.length > 0 && value.length < min;
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={`w-full border rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none resize-none ${
          over || underMin ? 'border-red-300' : 'border-slate-200'
        }`}
      />
      <div className="flex justify-end mt-1">
        <span className={`text-[10px] ${over ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
          {value.length}/{max}
        </span>
      </div>
      {underMin && <p className="text-[10px] text-red-500 mt-0.5">最少 {min} 字</p>}
    </div>
  );
};
