'use client';

import { ToastProvider } from '@/components/toast';
import { SidebarProvider } from '@/components/sidebar-context';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <ToastProvider>{children}</ToastProvider>
    </SidebarProvider>
  );
}
