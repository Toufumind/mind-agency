'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface AgentInfo { name: string; emailCount: number; }
interface GroupInfo { name: string; }
interface AgentActivityEntry { active: boolean; status: string; detail: string; }
interface AgentActivity { [name: string]: AgentActivityEntry; }

interface SidebarData {
  agents: AgentInfo[];
  groups: GroupInfo[];
  activity: AgentActivity;
  loading: boolean;
  refresh: () => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarData>({ agents: [], groups: [], activity: {}, loading: true, refresh: () => {}, collapsed: false, setCollapsed: () => {} });

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [activity, setActivity] = useState<AgentActivity>({});
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      fetch('/api/agents').then(r => r.json()),
      fetch('/api/groups/scan').then(r => r.json()),
    ]).then(([a, g]) => {
      setAgents(a.agents || []);
      setGroups((g.groups || []).map((n: string) => ({ name: n })));
    }).catch(() => {}).finally(() => setLoading(false));
  };

  const [loaded, setLoaded] = useState(false);

  // Init — load once
  useEffect(() => {
    refresh();
    setTimeout(() => setLoaded(true), 1000);
  }, []);

  // Keep sidebar in sync — refresh agents/groups every 10s
  useEffect(() => {
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, []);

  // WebSocket — real-time sidebar updates
  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (stopped) return;
      try {
        ws = new WebSocket(`ws://${window.location.hostname}:3001`);
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'sidebar_refresh') refresh();
          } catch {}
        };
        ws.onclose = () => { if (!stopped) reconnectTimer = setTimeout(connect, 3000); };
        ws.onerror = () => { ws?.close(); };
      } catch { if (!stopped) reconnectTimer = setTimeout(connect, 3000); }
    };
    connect();

    return () => { stopped = true; clearTimeout(reconnectTimer); ws?.close(); };
  }, []);

  // Poll heartbeats every 5s (after first load)
  useEffect(() => {
    if (!loaded || agents.length === 0) return;
    const poll = () => {
      Promise.all(
        agents.map(a =>
          fetch(`/api/agents/${a.name}/heartbeat`)
            .then(r => r.json())
            .then(d => ({ name: a.name, active: d.active || false, status: d.status || 'idle', detail: d.detail || '' }))
            .catch(() => ({ name: a.name, active: false, status: 'idle', detail: '' }))
        )
      ).then(results => {
        const map: AgentActivity = {};
        results.forEach(r => { map[r.name] = { active: r.active, status: r.status, detail: r.detail }; });
        setActivity(map);
      }).catch(() => {});
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [loaded, agents.length]);

  return (
    <SidebarContext.Provider value={{ agents, groups, activity, loading, refresh, collapsed, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebarData() { return useContext(SidebarContext); }
