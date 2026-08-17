// 独立于 React Context 的 toast 通道：供 Zustand store 等非组件代码在写操作失败时弹出错误提示，
// 避免“点击按钮无反应”却无任何反馈。ToastProvider 在挂载时注册自身 showToast，卸载时注销。
export type ToastType = 'success' | 'info' | 'warning' | 'error';

type ToastHandler = (message: string, type?: ToastType) => void;

let handler: ToastHandler | null = null;

export function setToastHandler(fn: ToastHandler | null): void {
  handler = fn;
}

export function toast(message: string, type: ToastType = 'error'): void {
  if (handler) {
    handler(message, type);
  } else if (typeof console !== 'undefined') {
    console.warn('[toast]', type, message);
  }
}
