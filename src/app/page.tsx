'use client';

import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/sidebar';
import { useSidebarData } from '@/components/sidebar-context';
import { useNotifications } from '@/components/notification-provider';
import Link from 'next/link';
import { Hash, Users, Mail, ArrowRight, AlertCircle, Clock } from 'lucide-react';
import { useT } from '@/components/i18n';
import LogoCanvas from '@/components/logo-canvas';

interface AgentInfo { name: string; emailCount: number; config?: { roles?: string[]; permissions?: Record<string, boolean>; autoRespondToEmail?: boolean; }; }
interface GroupInfo { name: string; }
interface PendingItem { type: string; id: string; group: string; requestedBy: string; description: string; createdAt: number; }
interface LeaderboardEntry { agent: string; balance: number; earned: number; tasks: number; }
interface OpenTask { id: string; group: string; title: string; description: string; reward: number; claims: any[]; status: string; postedBy: string; createdAt: number; }

export default function HomePage() {
  const { t } = useT();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [totalEmails, setTotalEmails] = useState(0);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [openTasks, setOpenTasks] = useState<OpenTask[]>([]);
  const sidebar = useSidebarData();
  const { unreadGroups } = useNotifications();

  const load = useCallback(() => {
    fetch('/api/agents').then(r => r.json()).then(d => {
      setAgents(d.agents || []);
      const total = (d.agents || []).reduce((sum: number, a: any) => sum + (a.emailCount || 0), 0);
      setTotalEmails(total);
    }).catch(() => {});
    fetch('/api/groups/scan').then(r => r.json()).then(d =>
      setGroups((d.groups || []).map((g: string) => ({ name: g })))
    ).catch(() => {});
    fetch('/api/system/pending').then(r => r.json()).then(d => setPending(d.items || [])).catch(() => {});
    fetch('http://127.0.0.1:3001/api/economy/leaderboard').then(r => r.json()).then(d =>
      setLeaderboard(d.leaderboard || [])
    ).catch(() => {});
    Promise.all(
      (groups || []).map(g =>
        fetch(`/api/tasks?group=${g.name}`).then(r => r.json()).catch(() => ({ tasks: [] }))
      )
    ).then(results => {
      const all = results.flatMap((r: any) => (r.tasks || []).filter((t: any) => t.status === 'open'));
      setOpenTasks(all);
    }).catch(() => {});
    sidebar.refresh();
  }, []);
  useEffect(()=>{load()},[load]);

  const nonMe = agents.filter(a => a.name !== 'me');

  return (
    <div className="flex h-full bg-canvas overflow-hidden"><Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-10">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2.5">
              <LogoCanvas size={28} />
              <h1 className="text-[18px] font-bold text-foreground tracking-tight">{t('dashboard')}</h1>
            </div>
          </div>

          {/* ── Stats row — taste: one intent per screen, not 8-card wall ── */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <StatCard icon={<Users size={15} className="text-info"/>} bg="bg-info-muted" value={nonMe.length} label={t('agents')} />
            <StatCard icon={<Hash size={15} className="text-info"/>} bg="bg-info-muted" value={groups.length} label={t('groups')} />
            <StatCard icon={<AlertCircle size={15} className="text-destructive"/>} bg="bg-destructive-muted" value={pending.length} label={t('pending')} />
          </div>

          {/* ── Two-column: Agent cards + Pending/Activity ── */}
          <div className="flex gap-6 mb-8">
            {/* Left: Agent status cards */}
            <div className="flex-1 min-w-0">
              <h2 className="text-[12px] font-medium text-muted mb-3 flex items-center gap-1.5"><Users size={12}/> Agent</h2>
              <div className="space-y-2">
                {nonMe.length === 0 && groups.length === 0 ? (
                  <div className="bg-gradient-to-br from-surface to-canvas border border-border rounded-2xl p-8 text-center mb-6">
                    <div className="flex justify-center mb-4"><LogoCanvas size={40} /></div>
                    <h3 className="text-[16px] font-semibold text-foreground mb-2">{t('welcome')}</h3>
                    <p className="text-[13px] text-muted leading-relaxed max-w-md mx-auto">{t('welcome_desc')}</p>
                  </div>
                ) : nonMe.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground py-4">{t('no_agents') || '暂无 Agent'}</p>
                ) : (
                  nonMe.map(a => <AgentCard key={a.name} agent={a} activity={sidebar.activity[a.name]} />)
                )}
              </div>
            </div>

            {/* Right: Pending + Activity */}
            <div className="w-[340px] shrink-0 space-y-4">
              {/* Pending approvals */}
              {pending.length > 0 && (
                <div className="bg-canvas border border-border rounded-2xl p-4">
                  <h2 className="text-[12px] font-medium text-muted mb-3 flex items-center gap-1.5"><AlertCircle size={12}/> 待审批</h2>
                  <div className="space-y-1.5">
                    {pending.slice(0, 5).map(p => (
                      <Link key={`${p.type}-${p.id}`} href={p.group ? `/groups/${p.group}` : '#'}
                        className="flex items-start gap-2.5 px-2 py-2 hover:bg-surface rounded-lg transition-colors">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded mt-0.5 shrink-0 ${
                          p.type === 'consensus' ? 'bg-warning-muted text-warning' : 'bg-info-muted text-info'
                        }`}>{p.type === 'consensus' ? '共识' : '工作流'}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] text-foreground truncate">{p.description}</p>
                          <p className="text-[10px] text-muted-foreground">{p.requestedBy} · {timeAgo(t, p.createdAt)}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Live activity (compact) */}
              <LiveActivity />
            </div>
          </div>

          {/* ── Groups ── */}
          {groups.length > 0 && (
            <div className="mb-8">
              <h2 className="text-[12px] font-medium text-muted mb-3 flex items-center gap-1.5"><Hash size={12}/> {t('groups')}</h2>
              <div className="space-y-2">
                {groups.map(g => {
                  const unread = unreadGroups[g.name] || 0;
                  return (
                    <Link key={g.name} href={`/groups/${g.name}`} className="flex items-center gap-3 bg-canvas border border-border rounded-xl px-4 py-3 hover:shadow-sm transition-all group">
                      <span className="w-7 h-7 rounded-lg bg-surface flex items-center justify-center text-[10px] font-bold text-muted shrink-0">#</span>
                      <span className="text-[13px] font-medium text-foreground flex-1">{g.name}</span>
                      <div className="flex items-center gap-2">
                        {unread > 0 && <span className="text-[10px] bg-destructive text-canvas rounded-full w-5 h-5 flex items-center justify-center font-bold">{unread>9?'9+':unread}</span>}
                        <ArrowRight size={13} className="text-muted-foreground/40 group-hover:text-muted-foreground transition-colors"/>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Economy: Leaderboard ── */}
          {leaderboard.length > 0 && (
            <div className="mb-8">
              <h2 className="text-[12px] font-medium text-muted mb-3 flex items-center gap-1.5">💰 Token 排行榜</h2>
              <div className="bg-canvas border border-border rounded-2xl overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead><tr className="border-b border-border">
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">#</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Agent</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">余额</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">累计收入</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">任务</th>
                  </tr></thead>
                  <tbody>
                    {leaderboard.slice(0, 5).map((e, i) => (
                      <tr key={e.agent} className="border-b border-border/50 last:border-0 hover:bg-surface/50 transition-colors">
                        <td className="px-4 py-2 text-muted-foreground">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                        <td className="px-4 py-2 font-medium text-foreground">{e.agent}</td>
                        <td className="px-4 py-2 text-right font-mono text-foreground">{e.balance.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right font-mono text-muted-foreground">{e.earned.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{e.tasks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Open Tasks ── */}
          {openTasks.length > 0 && (
            <div className="mb-8">
              <h2 className="text-[12px] font-medium text-muted mb-3 flex items-center gap-1.5">📋 开放任务</h2>
              <div className="space-y-2">
                {openTasks.slice(0, 5).map(task => (
                  <Link key={`${task.group}-${task.id}`} href={`/groups/${task.group}`}
                    className="flex items-center gap-3 bg-canvas border border-border rounded-xl px-4 py-3 hover:shadow-sm transition-all group">
                    <div className="w-7 h-7 rounded-lg bg-info-muted flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-bold text-info">{task.claims?.length || 0}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-foreground truncate">{task.title}</p>
                      <p className="text-[10px] text-muted-foreground">{task.group} · {task.postedBy} · {timeAgo(t, task.createdAt)}</p>
                    </div>
                    {task.reward > 0 && (
                      <span className="text-[11px] font-mono text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full shrink-0">{task.reward} tokens</span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, bg, value, label }: { icon: React.ReactNode; bg: string; value: string | number; label: string }) {
  return (
    <div className="bg-canvas border border-border rounded-xl p-5 hover:shadow-sm transition-all">
      <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center mb-3`}>{icon}</div>
      <p className="text-[24px] font-bold text-foreground tracking-tight">{value}</p>
      <p className="text-[12px] text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function AgentCard({ agent, activity }: { agent: AgentInfo; activity: any }) {
  const status = activity?.status || 'idle';
  const isBusy = ['processing','chatting','working'].includes(status);
  const detail = activity?.detail || '';
  const roles = (agent.config?.roles || []).join(', ') || '成员';

  return (
    <Link href={`/agents/${agent.name}`} className="flex items-center gap-3 bg-canvas border border-border rounded-xl p-3.5 hover:shadow-sm transition-all group">
      <span className={`w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-medium shrink-0 ${
        isBusy ? 'bg-success-muted text-success' : 'bg-surface-alt text-muted'
      }`}>{agent.name[0]}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-foreground">{agent.name}</span>
          <span className={`w-2 h-2 rounded-full ${isBusy ? 'bg-success' : activity?.active ? 'bg-success-muted' : 'bg-border'}`} />
        </div>
        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
          {isBusy ? detail : activity?.active ? '空闲' : '离线'} · {roles}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Mail size={12} className="text-muted-foreground/50"/>
        <span className="text-[10px] text-muted-foreground">{agent.emailCount}</span>
        <ArrowRight size={13} className="text-muted-foreground/30 group-hover:text-muted-foreground transition-colors ml-1"/>
      </div>
    </Link>
  );
}

function LiveActivity() {
  const { t } = useT();
  const [events, setEvents] = useState<any[]>([]);
  useEffect(() => {
    const load = () => fetch('/api/system/analytics').then(r => r.json()).then(d => {
      // Filter out idle events — only show meaningful actions
      setEvents((d.activity || []).filter((e: any) => e.type !== 'agent_idle').slice(0, 8));
    }).catch(() => {});
    load();
    const timer = setInterval(load, 15000);
    let ws: WebSocket|null=null, stopped=false, rt:any;
    const connect = () => { if(stopped)return; try{ws=new WebSocket(`ws://${window.location.hostname}:3001`); ws.onmessage=e=>{try{const d=JSON.parse(e.data);if(d.type==='dashboard_refresh')load()}catch{}}; ws.onclose=()=>{if(!stopped)rt=setTimeout(connect,3000)}; }catch{ if(!stopped)rt=setTimeout(connect,3000); } };
    connect();
    return () => { stopped=true; clearInterval(timer); clearTimeout(rt); ws?.close(); };
  }, []);

  if (events.length === 0) return null;

  return (
    <div className="bg-canvas border border-border rounded-2xl p-4">
      <h2 className="text-[12px] font-medium text-muted mb-3 flex items-center gap-1.5"><Clock size={12}/> 最近活动</h2>
      <div className="space-y-1 max-h-[240px] overflow-y-auto">
        {events.map((e,i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-1.5 hover:bg-surface rounded-lg transition-colors text-[12px]">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${e.type==='decide'?'bg-success':e.type==='email'?'bg-warning':'bg-info'}`}/>
            <span className="font-medium text-muted shrink-0">{e.agent}</span>
            {e.group && <span className="text-muted-foreground/60 shrink-0">#{e.group}</span>}
            <span className="text-muted-foreground truncate">{e.detail}</span>
            <span className="text-[9px] text-muted-foreground/50 shrink-0 ml-auto">{timeAgo(t, e.timestamp)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function timeAgo(t:(k:string,v?:Record<string,string|number>)=>string, ts:number):string {
  const s=Math.floor((Date.now()-ts)/1000);
  if(s<60)return t('just_now');
  if(s<3600)return t('min_ago',{n:Math.floor(s/60)});
  return t('hour_ago',{n:Math.floor(s/3600)});
}
