'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

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

  // Unified refresh — taste: one intent, one action
  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/agents').then(r => r.json()),
      fetch('/api/groups/scan').then(r => r.json()),
    ]).then(([a, g]) => {
      setAgents(a.agents || []);
      setGroups((g.groups || []).map((n: string) => ({ name: n })));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const [loaded, setLoaded] = useState(false);

  // Init — load once
  useEffect(() => {
    refresh();
    setTimeout(() => setLoaded(true), 1000);
  }, [refresh]);

  // Unified polling — taste: one interval, not four
  // Combines: sidebar refresh (10s) + heartbeat (5s) + chat polling
  useEffect(() => {
    if (!loaded) return;

    const poll = async () => {
      try {
        // Batch heartbeat check for all agents
        const agentResults = await Promise.all(
          agents.map(a =>
            fetch(`/api/agents/${a.name}/heartbeat`)
              .then(r => r.json())
              .then(d => ({ name: a.name, active: d.active || false, status: d.status || 'idle', detail: d.detail || '' }))
              .catch(() => ({ name: a.name, active: false, status: 'idle', detail: '' }))
          )
        );
        const map: AgentActivity = {};
        agentResults.forEach(r => { map[r.name] = { active: r.active, status: r.status, detail: r.detail }; });
        setActivity(map);
      } catch {}
    };

    // Initial poll
    if (agents.length > 0) poll();

    // Single interval — 15s (was 4 separate intervals: 5s + 10s + 15s)
    const t = setInterval(() => {
      refresh();
      if (agents.length > 0) poll();
    }, 15_000);

    return () => clearInterval(t);
  }, [loaded, agents.length, refresh]);

  // Single WebSocket — taste: one connection, not four
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
        ws.onclose = () => { if (!stopped) reconnectTimer = setTimeout(connect, 5000); };
        ws.onerror = () => { ws?.close(); };
      } catch { if (!stopped) reconnectTimer = setTimeout(connect, 5000); }
    };
    connect();

    return () => { stopped = true; clearTimeout(reconnectTimer); ws?.close(); };
  }, [refresh]);

  return (
    <SidebarContext.Provider value={{ agents, groups, activity, loading, refresh, collapsed, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebarData() { return useContext(SidebarContext); }
