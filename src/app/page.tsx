'use client';

import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/sidebar';
import Link from 'next/link';
import { Hash, Users, Mail, Zap, Shield, RefreshCw, ArrowRight } from 'lucide-react';

interface AgentInfo { name: string; emailCount: number; config?: { roles?: string[]; permissions?: Record<string, boolean>; autoRespondToEmail?: boolean; }; }
interface GroupInfo { name: string; messageCount: number; memberCount: number; lastActivity?: string; }

export default function HomePage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [totalEmails, setTotalEmails] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/agents').then(r => r.json()).then(d => {
      setAgents(d.agents || []);
      let t = 0; for (const a of d.agents || []) t += a.emailCount; setTotalEmails(t);
    }).catch(() => {}).finally(() => setLoading(false));
    fetch('/api/groups/scan').then(r => r.json()).then(async d => {
      setGroups((d.groups || []).map((g: string) => ({ name: g, messageCount: 0, memberCount: 0 })));
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-10">
          <div className="flex items-center justify-between mb-10">
            <div>
              <h1 className="text-[24px] font-semibold text-gray-900 tracking-tight">Mind Agency</h1>
              <p className="text-[13px] text-gray-400 mt-1.5">Multi-agent collaboration dashboard</p>
            </div>
            <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-xl text-[12px] text-gray-600 hover:bg-gray-50 transition-all">
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3 mb-10">
            <StatCard icon={<Users size={16} />} label="Agents" value={agents.length} color="text-blue-600" bg="bg-blue-50" />
            <StatCard icon={<Hash size={16} />} label="Groups" value={groups.length} color="text-indigo-600" bg="bg-indigo-50" />
            <StatCard icon={<Mail size={16} />} label="Emails" value={totalEmails} color="text-amber-600" bg="bg-amber-50" />
            <StatCard icon={<Zap size={16} />} label="Auto-Resp" value={agents.filter(a => a.config?.autoRespondToEmail).length} sub="active" color="text-green-600" bg="bg-green-50" />
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <h2 className="text-[12px] font-medium text-gray-400 uppercase tracking-widest flex items-center gap-2"><Hash size={12} /> Groups</h2>
              {groups.map(g => (
                <Link key={g.name} href={`/groups/${g.name}`} className="block bg-white border border-gray-100 rounded-2xl p-4 hover:border-gray-200 hover:shadow-sm transition-all">
                  <span className="text-[14px] font-medium text-gray-800">#{g.name}</span>
                </Link>
              ))}
            </div>
            <div className="space-y-4">
              <h2 className="text-[12px] font-medium text-gray-400 uppercase tracking-widest flex items-center gap-2"><Users size={12} /> Agents</h2>
              {agents.map(a => {
                const isAdmin = a.config?.roles?.includes('admin');
                return (
                  <Link key={a.name} href={`/agents/${a.name}`} className="flex items-center gap-3 bg-white border border-gray-100 rounded-2xl p-4 hover:border-gray-200 hover:shadow-sm transition-all">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-medium ${isAdmin ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>{a.name[0]}</span>
                    <div>
                      <span className="text-[13px] font-medium text-gray-800">{a.name}</span>
                      <p className="text-[11px] text-gray-400">{a.config?.roles?.join(', ') || 'member'}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color, bg }: { icon: React.ReactNode; label: string; value: number | string; sub?: string; color: string; bg: string; }) {
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
