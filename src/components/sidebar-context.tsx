'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface AgentInfo { name: string; emailCount: number; }
interface GroupInfo { name: string; }
interface AgentActivity { [name: string]: boolean; } // active = true, idle = false

interface SidebarData {
  agents: AgentInfo[];
  groups: GroupInfo[];
  activity: AgentActivity;
  loading: boolean;
  refresh: () => void;
}

const SidebarContext = createContext<SidebarData>({ agents: [], groups: [], activity: {}, loading: true, refresh: () => {} });

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [activity, setActivity] = useState<AgentActivity>({});
  const [loading, setLoading] = useState(true);

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

  // Init — load once, then poll heartbeats
  useEffect(() => {
    refresh();
    setTimeout(() => setLoaded(true), 1000); // wait for agents to populate
  }, []);

  // Poll heartbeats every 5s (after first load)
  useEffect(() => {
    if (!loaded || agents.length === 0) return;
    const poll = () => {
      Promise.all(
        agents.map(a =>
          fetch(`/api/agents/${a.name}/heartbeat`)
            .then(r => r.json())
            .then(d => ({ name: a.name, active: d.active || false }))
            .catch(() => ({ name: a.name, active: false }))
        )
      ).then(results => {
        const map: AgentActivity = {};
        results.forEach(r => { map[r.name] = r.active; });
        setActivity(map);
      }).catch(() => {});
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [loaded, agents.length]);

  return (
    <SidebarContext.Provider value={{ agents, groups, activity, loading, refresh }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebarData() { return useContext(SidebarContext); }
