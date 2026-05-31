'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface AgentInfo { name: string; emailCount: number; }
interface GroupInfo { name: string; }

interface SidebarData {
  agents: AgentInfo[];
  groups: GroupInfo[];
  loading: boolean;
  refresh: () => void;
}

const SidebarContext = createContext<SidebarData>({ agents: [], groups: [], loading: true, refresh: () => {} });

// Shared across all pages — loads once
export function SidebarProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
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

  useEffect(() => { refresh(); }, []);

  return (
    <SidebarContext.Provider value={{ agents, groups, loading, refresh }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebarData() { return useContext(SidebarContext); }
