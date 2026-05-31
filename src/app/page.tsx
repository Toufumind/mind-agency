'use client';

import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/sidebar';
import Link from 'next/link';
import {
  Hash, Users, Mail, Activity, Zap, Bot, Play, Shield,
  Clock, CheckCircle, AlertCircle, RefreshCw, ArrowRight,
} from 'lucide-react';

interface AgentInfo { name: string; emailCount: number; config?: { roles?: string[]; permissions?: Record<string, boolean>; autoRespondToEmail?: boolean; autoProcessGroupInvites?: boolean; }; }
interface GroupInfo { name: string; messageCount: number; memberCount: number; lastActivity?: string; }
interface AuditEntry { agent: string; action: string; resource: string; timestamp: string; status?: string; }
interface WSStatus { connected: boolean; }

export default function HomePage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [totalEmails, setTotalEmails] = useState(0);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [wsStatus, setWsStatus] = useState<WSStatus>({ connected: false });

  const load = useCallback(() => {
    setLoading(true);
    // Agents
    fetch('/api/agents').then(r => r.json()).then(d => {
      setAgents(d.agents || []);
      let t = 0; for (const a of d.agents || []) t += a.emailCount; setTotalEmails(t);
    }).catch(() => {});

    // Groups with details
    fetch('/api/groups/scan').then(r => r.json()).then(async d => {
      const groupNames = d.groups || [];
      const detailed: GroupInfo[] = [];
      for (const g of groupNames) {
        try {
          const gr = await fetch(`/api/groups/${g}`);
          const gd = await gr.json();
          detailed.push({
            name: g,
            messageCount: gd.messageCount || 0,
            memberCount: (gd.members || []).length,
            lastActivity: gd.messages?.length > 0 ? gd.messages[gd.messages.length - 1]?.from : undefined,
          });
        } catch { detailed.push({ name: g, messageCount: 0, memberCount: 0 }); }
      }
      setGroups(detailed);
    }).catch(() => {});

    // Audit
    fetch('/api/audit?limit=10').then(r => r.json()).then(d => {
      setAuditLogs(d.logs || []);
    }).catch(() => {});

    // WebSocket status
    try {
      const ws = new WebSocket(`ws://localhost:3001`);
      ws.onopen = () => { setWsStatus({ connected: true }); ws.close(); };
      ws.onerror = () => setWsStatus({ connected: false });
      setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) { ws.close(); setWsStatus({ connected: false }); } }, 2000);
    } catch { setWsStatus({ connected: false }); }

    setLoading(false);
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

  const actionText = (action: string) => {
    if (action.includes('chat')) return 'Chat';
    if (action.includes('email')) return 'Email';
    if (action.includes('group')) return 'Group';
    if (action.includes('config')) return 'Config';
    if (action.includes('agent')) return 'Agent';
    if (action.includes('workflow')) return 'Workflow';
    return action;
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
            <StatCard icon={<Activity size={16} />} label="WS Push" value={wsStatus.connected ? 'Live' : 'Off'} color={wsStatus.connected ? 'text-emerald-600' : 'text-gray-400'} bg={wsStatus.connected ? 'bg-emerald-50' : 'bg-gray-50'} />
          </div>

          {/* Main 3-column layout */}
          <div className="grid grid-cols-3 gap-6">
            {/* Groups column */}
            <div className="space-y-4">
              <h2 className="text-[12px] font-medium text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <Hash size={12} /> Groups
              </h2>
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

            {/* Agents column */}
            <div className="space-y-4">
              <h2 className="text-[12px] font-medium text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <Users size={12} /> Agents
              </h2>
              {agents.map(a => {
                const isAdmin = a.config?.roles?.includes('admin');
                const autoOn = a.config?.autoRespondToEmail;
                return (
                  <Link key={a.name} href={`/agents/${a.name}`}
                    className="block bg-white border border-gray-100 rounded-2xl p-4 hover:border-gray-200 hover:shadow-sm transition-all group">
                    <div className="flex items-center gap-3">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-medium ${
                        isAdmin ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
                      }`}>{a.name[0]}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-gray-800">{a.name}</span>
                          {isAdmin && <Shield size={10} className="text-gray-400" />}
                          {autoOn && <span className="text-[9px] bg-green-50 text-green-500 px-1.5 py-0.5 rounded-full">auto</span>}
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {a.config?.roles?.join(', ') || 'member'}
                          {a.emailCount > 0 && ` · ${a.emailCount} emails`}
                        </p>
                      </div>
                      <ArrowRight size={14} className="text-gray-200 group-hover:text-gray-400 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Activity + Audit column */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[12px] font-medium text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <Activity size={12} /> Recent Activity
                </h2>
                <Link href="/" className="text-[10px] text-gray-400 hover:text-gray-600">View all</Link>
              </div>

              {auditLogs.length === 0 ? (
                <div className="bg-white border border-gray-100 rounded-2xl p-6 text-center">
                  <Clock size={20} className="text-gray-200 mx-auto mb-2" />
                  <p className="text-[12px] text-gray-400">No activity yet</p>
                  <p className="text-[11px] text-gray-300 mt-1">Actions will appear here</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {auditLogs.slice(0, 8).map((entry, i) => (
                    <div key={i} className="bg-white border border-gray-100 rounded-xl px-3.5 py-2.5 flex items-center gap-3">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        entry.status === 'error' ? 'bg-red-400' : entry.status === 'success' ? 'bg-green-400' : 'bg-gray-300'
                      }`} />
                      <span className="text-[10px] font-medium text-gray-500 w-14">{actionText(entry.action)}</span>
                      <span className="text-[11px] text-gray-700 truncate">{entry.agent}</span>
                      <span className="text-[10px] text-gray-300 ml-auto font-mono">
                        {entry.timestamp?.slice(11, 16)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
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
