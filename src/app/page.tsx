'use client';

import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/sidebar';
import Link from 'next/link';
import TokenChart from '@/components/dashboard/token-chart';
import AgentStatusCards from '@/components/dashboard/agent-status';
import ActivityTimeline from '@/components/dashboard/activity-timeline';
import {
  Hash, Users, Mail, Activity, Zap, Shield,
  RefreshCw, ArrowRight,
} from 'lucide-react';

interface AgentInfo { name: string; emailCount: number; config?: { roles?: string[]; permissions?: Record<string, boolean>; autoRespondToEmail?: boolean; autoProcessGroupInvites?: boolean; }; }
interface GroupInfo { name: string; messageCount: number; memberCount: number; lastActivity?: string; }

export default function HomePage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [totalEmails, setTotalEmails] = useState(0);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/agents').then(r => r.json()).then(d => {
      setAgents(d.agents || []);
      let t = 0; for (const a of d.agents || []) t += a.emailCount; setTotalEmails(t);
    }).catch(() => {}).finally(() => setLoading(false));
    fetch('/api/groups/scan').then(r => r.json()).then(async d => {
      const groupNames = d.groups || [];
      setGroups(groupNames.map((g: string) => ({ name: g, messageCount: 0, memberCount: 0 })));
      for (const g of groupNames) {
        fetch(`/api/groups/${g}`).then(r => r.json()).then(gd => {
          setGroups(prev => prev.map(p => p.name === g ? {
            name: g, messageCount: gd.messageCount || 0,
            memberCount: (gd.members || []).length,
            lastActivity: gd.messages?.length > 0 ? gd.messages[gd.messages.length - 1]?.from : undefined,
          } : p));
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePoll = async () => {
    setPolling(true);
    try {
      const r = await fetch('/api/poll', { method: 'POST' });
      const d = await r.json();
      alert(`Polled ${d.polled} agents, ${d.triggered} triggered.`);
    } catch {}
    setPolling(false);
    setTimeout(load, 2000);
  };

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-10">
          {/* Header */}
          <div className="flex items-center justify-between mb-10">
            <div>
              <h1 className="text-[24px] font-semibold text-gray-900 tracking-tight">Mind Agency</h1>
              <p className="text-[13px] text-gray-400 mt-1.5">Multi-agent collaboration dashboard</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={handlePoll} disabled={polling}
                className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-xl text-[12px] text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all">
                <Zap size={13} /> {polling ? 'Polling...' : 'Poll All'}
              </button>
              <button onClick={load}
                className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-xl text-[12px] text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all">
                <RefreshCw size={13} /> Refresh
              </button>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-5 gap-3 mb-10">
            <StatCard icon={<Users size={16} />} label="Agents" value={agents.length} color="text-blue-600" bg="bg-blue-50" />
            <StatCard icon={<Hash size={16} />} label="Groups" value={groups.length} color="text-indigo-600" bg="bg-indigo-50" />
            <StatCard icon={<Mail size={16} />} label="Emails" value={totalEmails} color="text-amber-600" bg="bg-amber-50" />
            <StatCard icon={<Zap size={16} />} label="Auto-Resp" value={agents.filter(a => a.config?.autoRespondToEmail).length} sub={`${agents.filter(a => a.config?.autoRespondToEmail).length}' on`} color="text-green-600" bg="bg-green-50" />
            <StatCard icon={<Shield size={16} />} label="Admin" value={agents.filter(a => a.config?.roles?.includes('admin')).length} sub="admins" color="text-purple-600" bg="bg-purple-50" />
          </div>

          {/* Agent-created Dashboard panels */}
          <div className="grid grid-cols-3 gap-6 mb-10">
            <TokenChart events={[]} />
            <AgentStatusCards events={[]} knownAgents={agents} />
            <ActivityTimeline events={[]} />
          </div>

          {/* Groups & Agents */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <h2 className="text-[12px] font-medium text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <Hash size={12} /> Groups
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {groups.map(g => (
                  <Link key={g.name} href={`/groups/${g.name}`}
                    className="block bg-white border border-gray-100 rounded-2xl p-4 hover:border-gray-200 hover:shadow-sm transition-all group">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[14px] font-medium text-gray-800">#{g.name}</span>
                      <span className="text-[11px] text-gray-400">{g.memberCount} members</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-gray-400">
                      <span className="flex items-center gap-1"><Mail size={10} /> {g.messageCount} msgs</span>
                      {g.lastActivity && <span className="text-gray-300">last: {g.lastActivity}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <h2 className="text-[12px] font-medium text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <Users size={12} /> Agents
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {agents.map(a => {
                  const isAdmin = a.config?.roles?.includes('admin');
                  const autoOn = a.config?.autoRespondToEmail;
                  return (
                    <Link key={a.name} href={`/agents/${a.name}`}
                      className="block bg-white border border-gray-100 rounded-2xl p-4 hover:border-gray-200 hover:shadow-sm transition-all group">
                      <div className="flex items-center gap-3">
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-medium ${isAdmin ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>{a.name[0]}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-gray-800">{a.name}</span>
                            {isAdmin && <Shield size={10} className="text-gray-400" />}
                            {autoOn && <span className="text-[9px] bg-green-50 text-green-500 px-1.5 py-0.5 rounded-full">auto</span>}
                          </div>
                          <p className="text-[11px] text-gray-400 mt-0.5">{a.config?.roles?.join(', ') || 'member'}</p>
                        </div>
                        <ArrowRight size={14} className="text-gray-200 group-hover:text-gray-400 group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color, bg }: {
  icon: React.ReactNode; label: string; value: number | string; sub?: string; color: string; bg: string;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 hover:shadow-sm transition-all">
      <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center mb-2.5`}>
        <span className={color}>{icon}</span>
      </div>
      <p className="text-[20px] font-semibold text-gray-900 leading-none">{value}</p>
      <p className="text-[11px] text-gray-400 mt-1">{sub || label}</p>
    </div>
  );
}
