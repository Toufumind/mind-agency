'use client';

import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/sidebar';
import Link from 'next/link';
import { Hash, Users, Mail, Activity, ArrowRight, Clock, Check, AlertCircle } from 'lucide-react';

interface AgentInfo { name: string; emailCount: number; }
interface GroupInfo { name: string; }
interface ActivityItem { group: string; from: string; time: string; snippet: string; }

export default function HomePage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [totalEmails, setTotalEmails] = useState(0);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [autoAgents, setAutoAgents] = useState<string[]>([]);

  const load = useCallback(() => {
    fetch('/api/agents').then(r => r.json()).then(d => {
      setAgents(d.agents || []);
      let t = 0; for (const a of d.agents || []) t += a.emailCount; setTotalEmails(t);
    }).catch(() => {});

    fetch('/api/groups/scan').then(r => r.json()).then(d => {
      setGroups((d.groups || []).map((g: string) => ({ name: g })));
    }).catch(() => {});

    // Collect recent activity
    const act: ActivityItem[] = [];
    const groupNames = ['default', 'dev'];
    let loaded = 0;
    for (const gn of groupNames) {
      fetch(`/api/groups/${gn}`).then(r => r.json()).then(d => {
        if (d.messages && d.messages.length > 0) {
          const last = d.messages[d.messages.length - 1];
          act.push({ group: gn, from: last.from, time: last.date, snippet: last.body.slice(0, 80) });
        }
        loaded++;
        if (loaded === groupNames.length) {
          setActivity(act.sort((a, b) => b.time.localeCompare(a.time)));
        }
      }).catch(() => { loaded++; });
    }

    // Check auto-respond status
    const autoList: string[] = [];
    let agentLoad = 0;
    const agentNames = ['Alice', 'Bob', 'Charlie'];
    for (const an of agentNames) {
      fetch(`/api/agents/${an}/config`).then(r => r.json()).then(d => {
        if (d.autoRespondToEmail) autoList.push(an);
        agentLoad++;
        if (agentLoad === agentNames.length) setAutoAgents(autoList);
      }).catch(() => { agentLoad++; });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const timeAgo = (d: string) => {
    try {
      const ms = Date.now() - new Date(d).getTime();
      const min = Math.floor(ms / 60000);
      if (min < 1) return 'just now';
      if (min < 60) return `${min}m ago`;
      return `${Math.floor(min / 60)}h ago`;
    } catch { return ''; }
  };

  return (
    <div className="flex h-screen bg-white">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-10">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-[22px] font-semibold text-gray-900">Mind Agency</h1>
              <p className="text-[13px] text-gray-400 mt-1">Multi-agent collaboration platform</p>
            </div>
            <button onClick={load} className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors">Refresh</button>
          </div>

          {/* Status bar */}
          <div className="grid grid-cols-4 gap-3 mb-8">
            <Stat icon={<Users size={14} />} label="Agents" value={agents.length} />
            <Stat icon={<Hash size={14} />} label="Groups" value={groups.length} />
            <Stat icon={<Mail size={14} />} label="Emails" value={totalEmails} />
            <Stat icon={<Activity size={14} />} label="Auto-Respond" value={autoAgents.length} sub={`${autoAgents.join(', ') || 'none'}`} />
          </div>

          {/* Activity feed */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Activity */}
            <div>
              <h2 className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <Activity size={11} /> Recent Activity
              </h2>
              <div className="space-y-2">
                {activity.length === 0 ? (
                  <p className="text-[12px] text-gray-300 py-4 text-center">No recent activity</p>
                ) : activity.map((a, i) => (
                  <Link key={i} href={`/groups/${a.group}`}
                    className="block bg-white border border-gray-100 rounded-xl p-4 hover:border-gray-200 transition-all">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-md bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-500">#</span>
                        <span className="text-[12px] font-medium text-gray-800">{a.group}</span>
                      </div>
                      <span className="text-[10px] text-gray-300 flex items-center gap-1">
                        <Clock size={10} /> {timeAgo(a.time)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] text-gray-400">{a.from}</span>
                    </div>
                    <p className="text-[12px] text-gray-500 line-clamp-2 leading-relaxed">{a.snippet}</p>
                  </Link>
                ))}
              </div>
            </div>

            {/* Quick actions & status */}
            <div>
              <h2 className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <Check size={11} /> Status
              </h2>
              <div className="space-y-3">
                {/* Groups */}
                <div className="bg-white border border-gray-100 rounded-xl p-4">
                  <h3 className="text-[12px] font-medium text-gray-700 mb-2">Groups</h3>
                  <div className="space-y-1.5">
                    {groups.map(g => (
                      <Link key={g.name} href={`/groups/${g.name}`}
                        className="flex items-center gap-2 text-[12px] text-gray-500 hover:text-gray-700 transition-colors">
                        <Hash size={11} /> {g.name}
                        <ArrowRight size={10} className="ml-auto text-gray-300" />
                      </Link>
                    ))}
                  </div>
                </div>

                {/* Agents */}
                <div className="bg-white border border-gray-100 rounded-xl p-4">
                  <h3 className="text-[12px] font-medium text-gray-700 mb-2">Agents</h3>
                  <div className="space-y-1.5">
                    {agents.map(a => (
                      <Link key={a.name} href={`/agents/${a.name}`}
                        className="flex items-center gap-2 text-[12px] text-gray-500 hover:text-gray-700 transition-colors">
                        <span className="w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center text-[9px] text-gray-500">{a.name[0]}</span>
                        {a.name}
                        {autoAgents.includes(a.name) && (
                          <span className="text-[9px] bg-green-50 text-green-500 px-1.5 py-0.5 rounded ml-auto">auto</span>
                        )}
                        {a.emailCount > 0 && (
                          <span className="text-[10px] text-gray-300">{a.emailCount}</span>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <div className="flex items-center gap-2 text-gray-400 mb-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-[18px] font-semibold text-gray-900">{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{sub}</p>}
    </div>
  );
}
