'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { Check, X } from 'lucide-react';

type ToastType = 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let id = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const tid = ++id;
    setToasts(prev => [...prev, { id: tid, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== tid)), 2500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
        {toasts.map(t => (
          <div
            key={t.id}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-canvas border border-border text-[13px] text-muted shadow-sm"
            style={{ animation: 'slide-up 0.2s ease-out' }}
          >
            {t.type === 'success' ? (
              <Check size={14} className="text-success" />
            ) : (
              <X size={14} className="text-destructive" />
            )}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
