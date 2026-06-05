'use client';
import { useState, useEffect } from 'react';
import Sidebar from '@/components/sidebar';
import { FileText, Filter, Shield, Mail, Hash, GitBranch, UserPlus, UserMinus } from 'lucide-react';
import { useT } from '@/components/i18n';

interface AuditRow { agent: string; action: string; resource: string; timestamp: string; details?: string; status?: string; }

const ICON_MAP: Record<string, React.ReactNode> = {
  'group.send': <Hash size={11} className="text-indigo-500"/>,
  'group.read': <Hash size={11} className="text-muted-foreground"/>,
  'email.send': <Mail size={11} className="text-amber-500"/>,
  'workflow.decide': <GitBranch size={11} className="text-success"/>,
  'consensus.decide': <GitBranch size={11} className="text-success"/>,
  'agent.create': <UserPlus size={11} className="text-blue-500"/>,
  'group.kick': <UserMinus size={11} className="text-destructive"/>,
  'group.create': <UserPlus size={11} className="text-indigo-500"/>,
  'group.delete': <Shield size={11} className="text-destructive"/>,
  'config.change': <Shield size={11} className="text-primary"/>,
};

export default function AuditPage() {
  const { t } = useT();
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [agent, setAgent] = useState('');
  const [agents, setAgents] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const PAGE = 30;

  const load = () => {
    const params = new URLSearchParams();
    if (agent) params.set('agent', agent);
    params.set('limit', String(PAGE));
    params.set('offset', String(page * PAGE));
    fetch(`/api/audit?${params}`).then(r=>r.json()).then(d => {
      const rows = d.logs || [];
      setLogs(rows);
    }).catch(()=>{});
    fetch('/api/agents').then(r=>r.json()).then(d=>setAgents((d.agents||[]).map((a:any)=>a.name))).catch(()=>{});
  };

  useEffect(()=>{load();}, [agent, page]);

  const timeFmt = (d: string) => {
    try { const t = new Date(d); return t.toLocaleDateString([],{month:'short',day:'numeric'})+' '+t.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
    catch { return d.slice(0,16); }
  };

  return (
    <div className="flex h-full bg-canvas"><Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-10">
          <h1 className="text-[18px] font-semibold text-foreground mb-1 flex items-center gap-2"><FileText size={18} className="text-muted-foreground"/> {t('audit_log')}</h1>
          <p className="text-[12px] text-muted-foreground mb-6">{t('audit_desc')}</p>

          {/* Filter */}
          <div className="flex items-center gap-2 mb-6">
            <button onClick={()=>{setAgent('');setPage(0);}} className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${!agent?'bg-surface-alt text-foreground':'text-muted hover:text-foreground'}`}>{t('all')}</button>
            {agents.map(a=><button key={a} onClick={()=>{setAgent(a);setPage(0);}} className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${agent===a?'bg-surface-alt text-foreground':'text-muted hover:text-foreground'}`}>{a}</button>)}
          </div>

          {/* Logs */}
          <div className="space-y-1">
            {logs.length===0 && <p className="text-[12px] text-muted-foreground py-8 text-center">{t('no_records')}</p>}
            {logs.map((l,i)=>(
              <div key={i} className="flex items-center gap-3 px-3 py-2 hover:bg-surface rounded-lg transition-colors">
                <div className="w-6 h-6 rounded-md bg-surface flex items-center justify-center shrink-0">
                  {ICON_MAP[l.action] || <FileText size={11} className="text-muted-foreground"/>}
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-[12px] font-medium text-muted">{l.agent}</span>
                  <span className="text-[11px] text-muted-foreground truncate">{l.action}</span>
                  {l.resource && <span className="text-[10px] text-muted-foreground truncate">{l.resource}</span>}
                  {l.details && <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">{l.details.slice(0,60)}</span>}
                </div>
                <span className="text-[9px] text-muted-foreground shrink-0">{timeFmt(l.timestamp)}</span>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {logs.length === PAGE && (
            <div className="flex items-center gap-2 mt-4 justify-center">
              <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0} className="px-3 py-1 text-[11px] text-muted hover:bg-surface rounded-lg disabled:opacity-30">{t('prev_page')}</button>
              <span className="text-[11px] text-muted-foreground">{t('page_n', { n: page+1 })}</span>
              <button onClick={()=>setPage(p=>p+1)} className="px-3 py-1 text-[11px] text-muted hover:bg-surface rounded-lg">{t('next_page')}</button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
