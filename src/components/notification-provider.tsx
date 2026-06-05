'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface Notification {
  id: string;
  type: 'group_message' | 'email' | 'sidebar_refresh' | 'mention' | 'wf_approval';
  text: string;
  link?: string;
  timestamp: number;
}

interface NotificationCtx {
  notifications: Notification[];
  dismiss: (id: string) => void;
  unreadGroups: Record<string, number>;   // group → unseen count
  unreadEmails: number;
  markGroupRead: (group: string) => void;
}

const Ctx = createContext<NotificationCtx>({
  notifications: [], dismiss: () => {}, unreadGroups: {}, unreadEmails: 0,
  markGroupRead: () => {},
});

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [unreadGroups, setUnreadGroups] = useState<Record<string, number>>({});
  const [unreadEmails, setUnreadEmails] = useState(0);

  const dismiss = (id: string) => setNotifs(prev => prev.filter(n => n.id !== id));

  const markGroupRead = (group: string) => {
    setUnreadGroups(prev => { const next = { ...prev }; delete next[group]; return next; });
  };

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let counter = 0;

    const connect = () => {
      if (stopped) return;
      try {
        ws = new WebSocket(`ws://${window.location.hostname}:3001`);
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            const id = `${Date.now()}-${++counter}`;

            if (data.type === 'group_message') {
              const group = data.group || 'unknown';
              const from = data.from || 'unknown';
              const mentionMe = data.message?.toLowerCase().includes('@me') || false;
              setNotifs(prev => [...prev.slice(-9), {
                id, type: mentionMe ? 'mention' : 'group_message',
                text: mentionMe
                  ? `@你 — ${from} 在 #${group}: ${(data.message || '').slice(0, 60)}`
                  : `${from} 在 #${group} 发言了`,
                link: `/groups/${group}`,
                timestamp: Date.now(),
              }]);
              // Increment unread for this group (unless current page is that group)
              if (window.location.pathname !== `/groups/${group}`) {
                setUnreadGroups(prev => ({ ...prev, [group]: (prev[group] || 0) + 1 }));
              }
            } else if (data.type === 'wf_approval') {
              setNotifs(prev => [...prev.slice(-9), {
                id, type: 'wf_approval',
                text: `工作流审批 — ${data.agent || ''} 在 ${data.group || ''}: ${(data.prompt || '').slice(0, 60)}`,
                link: `/groups/${data.group || 'default'}?tab=workflow`,
                timestamp: Date.now(),
              }]);
            } else if (data.type === 'email') {
              setUnreadEmails(prev => prev + 1);
              setNotifs(prev => [...prev.slice(-9), {
                id, type: 'email',
                text: `新邮件: ${data.from || ''} → ${data.to || ''}: ${data.subject || ''}`,
                link: '/me',
                timestamp: Date.now(),
              }]);
            } else if (data.type === 'sidebar_refresh') {
              // Handled by sidebar context directly
            }
          } catch {}
        };
        ws.onclose = () => { if (!stopped) reconnectTimer = setTimeout(connect, 3000); };
        ws.onerror = () => { ws?.close(); };
      } catch { if (!stopped) reconnectTimer = setTimeout(connect, 3000); }
    };
    connect();

    return () => { stopped = true; clearTimeout(reconnectTimer); ws?.close(); };
  }, []);

  return (
    <Ctx.Provider value={{ notifications: notifs, dismiss, unreadGroups, unreadEmails, markGroupRead }}>
      {children}
    </Ctx.Provider>
  );
}

export function useNotifications() { return useContext(Ctx); }
