'use client';

import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/sidebar';
import Link from 'next/link';
import { Hash, Users, Mail, Zap, RefreshCw, GitBranch, Clock, CheckCircle, XCircle, ArrowRight, UserCheck, Radio } from 'lucide-react';
import { useEventStream } from '@/hooks/use-event-stream';

interface AgentInfo { name: string; emailCount: number; config?: { roles?: string[]; permissions?: Record<string, boolean>; autoRespondToEmail?: boolean; }; }
interface GroupInfo { name: string; messageCount: number; memberCount: number; lastActivity?: string; }
interface PipelineRun { runId: string; group: string; workflow: string; status: string; stepsDone: number; totalSteps: number; pendingApproval?: { approvalId: string; stepId: string }; }
interface PipelineStats { totalRuns: number; running: number; completed: number; failed: number; runs: PipelineRun[]; }

export default function HomePage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [totalEmails, setTotalEmails] = useState(0);
  const [pipeline, setPipeline] = useState<PipelineStats>({ totalRuns: 0, running: 0, completed: 0, failed: 0, runs: [] });
  const [loading, setLoading] = useState(true);
  const [sysLoad, setSysLoad] = useState(0);
  const [uptime, setUptime] = useState(0);

  const loadSystem = useCallback(async () => {
    try {
      const s = await fetch('/api/system/status').then(r => r.json());
      setSysLoad(s.load?.loadPercent || 0);
      setUptime(s.uptime || 0);
    } catch {}
  }, []);

  const loadPipeline = useCallback(async () => {
    try {
      const gr = await fetch('/api/groups/scan').then(r => r.json());
      const gs: string[] = gr.groups || [];
      const runs: PipelineRun[] = [];
      for (const g of gs) {
        try {
          const w = await fetch(`/api/groups/${g}/workflow`).then(r => r.json());
          if (w.activeRuns) for (const r of w.activeRuns) runs.push({ ...r, group: g, workflow: w.name, totalSteps: w.steps });
        } catch {}
      }
      setPipeline({
        totalRuns: runs.length, running: runs.filter(r => r.status === 'running').length,
        completed: runs.filter(r => r.status === 'completed').length,
        failed: runs.filter(r => r.status === 'failed').length, runs,
      });
    } catch {}
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/agents').then(r => r.json()).then(d => {
      setAgents(d.agents || []);
      let t = 0; for (const a of d.agents || []) t += a.emailCount; setTotalEmails(t);
    }).catch(() => {}).finally(() => setLoading(false));
    fetch('/api/groups/scan').then(r => r.json()).then(d => {
      setGroups((d.groups || []).map((g: string) => ({ name: g, messageCount: 0, memberCount: 0 })));
    }).catch(() => {});
    loadPipeline();
    loadSystem();
  }, [loadPipeline, loadSystem]);

  useEffect(() => { load(); }, [load]);

  // ── WebSocket live events ──
  const { connected, lastEvent } = useEventStream({
    eventTypes: ['task.created', 'task.in_progress', 'task.completed', 'task.blocked', 'task.review_requested'],
    scope: 'all',
  });
  useEffect(() => {
    if (lastEvent && ['task.created', 'task.completed', 'task.blocked', 'task.review_requested'].includes(lastEvent.event)) {
      loadPipeline();
    }
  }, [lastEvent, loadPipeline]);

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-10">
          <div className="flex items-center justify-between mb-10">
            <div>
              <h1 className="text-[24px] font-semibold text-gray-900">Mind Agency</h1>
              <div className="flex items-center gap-2 mt-1.5">
                <p className="text-[13px] text-gray-400">Multi-agent collaboration dashboard</p>
                {connected && <span className="flex items-center gap-1 text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full"><Radio size={8} className="animate-pulse" /> Live</span>}
              </div>
            </div>
            <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-xl text-[12px] text-gray-600 hover:bg-gray-50"><RefreshCw size={13} /> Refresh</button>
          </div>

          <div className="grid grid-cols-5 gap-3 mb-10">
            <StatCard icon={<Users size={16} />} label="Agents" value={agents.length} color="text-blue-600" bg="bg-blue-50" />
            <StatCard icon={<Hash size={16} />} label="Groups" value={groups.length} color="text-indigo-600" bg="bg-indigo-50" />
            <StatCard icon={<Mail size={16} />} label="Emails" value={totalEmails} color="text-amber-600" bg="bg-amber-50" />
            <StatCard icon={<Zap size={16} />} label="Auto" value={agents.filter(a => a.config?.autoRespondToEmail).length} sub="active" color="text-green-600" bg="bg-green-50" />
            <StatCard icon={<GitBranch size={16} />} label="Pipeline" value={pipeline.running} sub={`${pipeline.completed} done · CPU ${sysLoad}% · ${Math.floor(uptime / 60)}m up`} color="text-purple-600" bg="bg-purple-50" />
          </div>

          <div className="grid grid-cols-2 gap-6 mb-10">
            <div className="space-y-4">
              <h2 className="text-[12px] font-medium text-gray-400 uppercase tracking-widest flex items-center gap-2"><Hash size={12} /> Groups</h2>
              {groups.map(g => (<Link key={g.name} href={`/groups/${g.name}`} className="block bg-white border border-gray-100 rounded-2xl p-4 hover:border-gray-200 hover:shadow-sm"><span className="text-[14px] font-medium text-gray-800">#{g.name}</span></Link>))}
            </div>
            <div className="space-y-4">
              <h2 className="text-[12px] font-medium text-gray-400 uppercase tracking-widest flex items-center gap-2"><Users size={12} /> Agents</h2>
              {agents.map(a => { const isAdmin = a.config?.roles?.includes('admin');
                return (<Link key={a.name} href={`/agents/${a.name}`} className="flex items-center gap-3 bg-white border border-gray-100 rounded-2xl p-4 hover:border-gray-200 hover:shadow-sm"><span className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-medium ${isAdmin ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>{a.name[0]}</span><div><span className="text-[13px] font-medium text-gray-800">{a.name}</span><p className="text-[11px] text-gray-400">{(a.config?.roles || []).join(', ') || 'member'}</p></div></Link>);
              })}
            </div>
          </div>

          {pipeline.runs.length > 0 && (
            <div className="border-t border-gray-100 pt-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[12px] font-medium text-gray-400 uppercase tracking-widest flex items-center gap-2"><GitBranch size={12} /> Active Pipelines</h2>
                <Link href="/workflows" className="text-[11px] text-indigo-500 hover:text-indigo-600 flex items-center gap-1">Manage <ArrowRight size={11} /></Link>
              </div>
              <div className="space-y-2">
                {pipeline.runs.map(run => (
                  <div key={run.runId} className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-4">
                    {run.status === 'completed' ? <CheckCircle size={16} className="text-green-500 shrink-0" /> : run.status === 'failed' ? <XCircle size={16} className="text-red-500 shrink-0" /> : <Clock size={16} className="text-sky-500 animate-pulse shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2"><span className="text-[13px] font-medium text-gray-800">{run.workflow}</span><span className="text-[11px] text-gray-400">#{run.group}</span><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${run.status === 'completed' ? 'bg-green-50 text-green-600' : run.status === 'failed' ? 'bg-red-50 text-red-600' : 'bg-sky-50 text-sky-600'}`}>{run.status}</span></div>
                      <div className="flex items-center gap-2 mt-1"><div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${run.status === 'completed' ? 'bg-green-400' : run.status === 'failed' ? 'bg-red-400' : 'bg-sky-400 animate-pulse'}`} style={{ width: `${run.totalSteps > 0 ? (run.stepsDone / run.totalSteps * 100) : 0}%` }} /></div><span className="text-[10px] text-gray-400 shrink-0">{run.stepsDone}/{run.totalSteps} steps</span></div>
                    </div>
                    <span className="text-[10px] text-gray-300 font-mono shrink-0">{run.runId.slice(-8)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color, bg }: { icon: React.ReactNode; label: string; value: number | string; sub?: string; color: string; bg: string; }) {
  return (<div className="bg-white border border-gray-100 rounded-2xl p-4 hover:shadow-sm"><div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center mb-2.5`}><span className={color}>{icon}</span></div><p className="text-[20px] font-semibold text-gray-900 leading-none">{value}</p><p className="text-[11px] text-gray-400 mt-1">{sub || label}</p></div>);
}
