import React, { useState, useCallback, createContext, useContext, useEffect } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { setToastHandler } from '../../lib/toastEmitter';

type ToastType = 'success' | 'info' | 'warning' | 'error';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType>({ showToast: () => {} });

export const useToast = () => useContext(ToastContext);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).slice(2, 11);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  // 注册到独立通道，供 store 等非组件代码调用
  useEffect(() => {
    setToastHandler(showToast);
    return () => setToastHandler(null);
  }, [showToast]);

  const dismiss = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const getStyles = (type: ToastItem['type']) => {
    switch (type) {
      case 'success': return { bg: 'bg-green-50 border-green-200', text: 'text-green-800', icon: <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" /> };
      case 'warning': return { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-800', icon: <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" /> };
      case 'error': return { bg: 'bg-red-50 border-red-200', text: 'text-red-800', icon: <AlertCircle className="w-5 h-5 text-red-600 shrink-0" /> };
      default: return { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-800', icon: <AlertCircle className="w-5 h-5 text-blue-600 shrink-0" /> };
    }
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-20 right-6 z-[9999] flex flex-col gap-3 pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => {
            const style = getStyles(toast.type);
            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, x: 50, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 50, scale: 0.95 }}
                className={`${style.bg} border ${style.text} px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 min-w-[280px] max-w-[400px] pointer-events-auto`}
              >
                {style.icon}
                <span className="text-sm font-medium flex-1">{toast.message}</span>
                <button onClick={() => dismiss(toast.id)} className="p-0.5 hover:opacity-70 transition-opacity">
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};
