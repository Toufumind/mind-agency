'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { ToastProvider } from '@/components/toast';
import { SidebarProvider } from '@/components/sidebar-context';
import { NotificationProvider, useNotifications } from '@/components/notification-provider';
import TitleBar from '@/components/title-bar';
import { X } from 'lucide-react';
import Link from 'next/link';

import { I18nProvider } from '@/components/i18n';
import { ThemeProvider } from '@/lib/theme';
import UpdateBanner from '@/components/update-banner';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SidebarProvider>
        <Suspense fallback={null}>
          <TitleBar />
        </Suspense>
        <div className="h-screen overflow-hidden" style={{ paddingTop: '36px' }}>
          <div className="h-full overflow-hidden">
            <ToastProvider>
              <NotificationProvider>
                <I18nProvider>
                  <Suspense fallback={null}>
                    <SetupRedirect />
                  </Suspense>
                  {children}
                </I18nProvider>
                <NotificationToast />
                <UpdateBanner />
              </NotificationProvider>
            </ToastProvider>
          </div>
        </div>
      </SidebarProvider>
    </ThemeProvider>
  );
}

function SetupRedirect() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Only check once per session
    const checked = sessionStorage.getItem('mind-setup-checked');
    if (checked) return;
    sessionStorage.setItem('mind-setup-checked', '1');

    if (pathname === '/setup') return;

    // Check if API is actually configured — if not, always redirect to setup
    fetch('/api/system/settings').then(r => r.json()).then(d => {
      if (!d.apiKey) {
        router.replace('/setup');
      } else {
        localStorage.setItem('mind-setup-done', '1'); // backwards compat
      }
    }).catch(() => {});
  }, [pathname, router]);

  return null;
}

function NotificationToast() {
  const { notifications, dismiss } = useNotifications();
  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 max-w-[360px]">
      {notifications.slice(-3).map(n => (
        <div key={n.id}
          className={`bg-canvas border border-border shadow-lg rounded-2xl px-4 py-3 flex items-start gap-3 animate-in slide-in-from-right transition-all ${
            n.type === 'mention' ? 'border-destructive-muted' :
            n.type === 'wf_approval' ? 'border-indigo-200 bg-indigo-50/50' : 'border-border'
          }`}>
          <div className="flex-1 min-w-0">
            {n.link ? (
              <Link href={n.link} onClick={() => dismiss(n.id)}
                className="text-[13px] text-foreground leading-snug hover:text-muted block">
                {n.text}
              </Link>
            ) : (
              <p className="text-[13px] text-foreground leading-snug">{n.text}</p>
            )}
            <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(n.timestamp)}</p>
          </div>
          <button onClick={() => dismiss(n.id)} className="text-disabled hover:text-muted shrink-0">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  return `${Math.floor(s / 3600)} 小时前`;
}
