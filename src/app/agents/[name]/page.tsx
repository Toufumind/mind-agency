'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import ChatPanel from '@/components/chat-panel';
import Sidebar from '@/components/sidebar';
import {
  Mail, FileText, Hash, Settings, X, RefreshCw, Zap, Shield, Clock,
  Activity, Check, AlertCircle, Plus
} from 'lucide-react';

interface Context { agent: string; emails: number; messages: number; groups: string[]; }
interface AgentConfig {
  autoRespondToEmail: boolean; autoProcessGroupInvites: boolean;
  notifyOnEmail: boolean; notifyOnGroupMention: boolean;
  roles: string[]; permissions: Record<string, boolean>;
}
interface AuditEntry { agent: string; action: string; resource: string; timestamp: string; status?: string; details?: string; }

const defaultConfig: AgentConfig = {
  autoRespondToEmail: false, autoProcessGroupInvites: false,
  notifyOnEmail: true, notifyOnGroupMention: true,
  roles: [], permissions: {},
};

export default function AgentPage() {
  const { name } = useParams<{ name: string }>();
  const [ctx, setCtx] = useState<Context | null>(null);
  const [showCtx, setShowCtx] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [config, setConfig] = useState<AgentConfig>(defaultConfig);
  const [saving, setSaving] = useState(false);
  const [polling, setPolling] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);

  const loadContext = useCallback(() => {
    Promise.all([
      fetch('/api/agents'),
      fetch(`/api/agents/${name}/chat`),
      fetch(`/api/groups/scan?agent=${name}`),
      fetch(`/api/emails?agent=${name}`),
    ]).then(async ([agentsR, chatR, groupsR, emailsR]) => {
      const agents = await agentsR.json();
      const chat = await chatR.json();
      const groups = await groupsR.json();
      const emails = await emailsR.json();
      setCtx({
        agent: name, emails: Array.isArray(emails) ? emails.length : 0,
        messages: chat.messages?.length || 0, groups: groups.groups || [],
      });
    }).catch(() => {});
  }, [name]);

  const loadConfig = useCallback(() => {
    fetch(`/api/agents/${name}/config`).then(r => r.json())
      .then(d => { if (!d.error) setConfig({ ...defaultConfig, ...d }); }).catch(() => {});
  }, [name]);

  const loadAudit = useCallback(() => {
    fetch(`/api/audit?agent=${name}&limit=20`).then(r => r.json())
      .then(d => setAuditLogs(d.logs || [])).catch(() => {});
  }, [name]);

  useEffect(() => { loadContext(); loadConfig(); }, [loadContext, loadConfig]);

  // Lazy load audit only when panel opens
  useEffect(() => { if (showAudit) loadAudit(); }, [showAudit, loadAudit]);

  // Background auto-poll
  useEffect(() => {
    if (!config.autoRespondToEmail) return;
    const t = setInterval(() => {
      fetch(`/api/agents/${name}/auto-respond`, { method: 'POST' })
        .then(r => r.json()).then(d => { if (d.triggered) { setTimeout(loadContext, 2000); setTimeout(loadAudit, 3000); } })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [config.autoRespondToEmail, name, loadContext, loadAudit]);

  const handlePoll = async () => {
    setPolling(true);
    try { await fetch(`/api/agents/${name}/auto-respond`, { method: 'POST' }); setTimeout(loadContext, 2000); setTimeout(loadAudit, 3000); }
    catch {}
    setPolling(false);
  };

  const toggleConfig = async (key: keyof AgentConfig) => {
    const next = { ...config, [key]: !config[key] };
    setConfig(next); setSaving(true);
    try { await fetch(`/api/agents/${name}/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: !config[key] }) }); }
    catch {}
    setSaving(false);
  };

  const tokenEstimate = ctx ? ctx.messages * 200 + ctx.emails * 50 + 15000 : 0;
  const tokenPct = Math.min(100, Math.round((tokenEstimate / 200000) * 100));

  const actionLabel = (action: string) => {
    if (action.includes('chat')) return 'Chat';
    if (action.includes('email')) return 'Email';
    if (action.includes('group')) return 'Group';
    if (action.includes('config')) return 'Config';
    if (action.includes('agent')) return 'Agent';
    return action.slice(0, 10);
  };

  const isAdmin = config.roles?.includes('admin');
  const autoOn = config.autoRespondToEmail;

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        {/* Context bar */}
        {ctx && showCtx && (
          <div className="px-5 py-2 border-b border-gray-100 bg-gray-50/30 flex items-center gap-4 shrink-0 text-[12px]">
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium ${isAdmin ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
                {name[0]}
              </span>
              <span className="font-medium text-gray-800">{name}</span>
              {isAdmin && <Shield size={10} className="text-gray-400" />}
              {autoOn && <span className="text-[9px] bg-green-50 text-green-500 px-1.5 py-0.5 rounded-full font-medium">auto</span>}
            </div>

            <span className="text-gray-200">|</span>
            <span className="flex items-center gap-1 text-gray-500"><Mail size={11} />{ctx.emails}</span>
            <span className="flex items-center gap-1 text-gray-500"><FileText size={11} />{ctx.messages}</span>
            {ctx.groups.length > 0 && <><span className="text-gray-200">|</span><span className="flex items-center gap-1 text-gray-500"><Hash size={11} />{ctx.groups.join(', ')}</span></>}

            {/* Token estimate */}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
              tokenPct > 80 ? 'bg-red-50 text-red-500' : tokenPct > 50 ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-400'
            }`} title={`~${(tokenEstimate/1000).toFixed(0)}k tokens`}>
              ~{(tokenEstimate/1000).toFixed(0)}k
            </span>

            <div className="ml-auto flex items-center gap-2">
              <button onClick={handlePoll} disabled={polling}
                className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${polling ? 'text-gray-300' : 'text-green-500 hover:text-green-700 hover:bg-green-50'}`}>
                <Zap size={11} className={polling ? 'animate-spin inline mr-0.5' : 'inline mr-0.5'} />Poll
              </button>
              <button onClick={loadContext} className="text-gray-300 hover:text-gray-500"><RefreshCw size={11} /></button>
              <button onClick={() => setShowAudit(!showAudit)}
                className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${showAudit ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-600'}`}>
                <Activity size={11} className="inline mr-1" />Audit
              </button>
              <button onClick={() => setShowConfig(!showConfig)}
                className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${showConfig ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-600'}`}>
                <Settings size={11} className="inline mr-1" />Config
              </button>
              <button onClick={() => setShowCtx(false)} className="text-gray-300 hover:text-gray-500"><X size={12} /></button>
            </div>
          </div>
        )}

        {/* Config panel */}
        {showConfig && (
          <div className="px-5 py-4 border-b border-gray-100 bg-white shrink-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h3 className="text-[13px] font-medium text-gray-800">Agent Configuration</h3>
                {saving && <span className="text-[10px] text-gray-400 animate-pulse">saving...</span>}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-gray-500">
                {isAdmin && <span className="flex items-center gap-1"><Shield size={10} /> admin</span>}
                <span>roles: {config.roles?.join(', ') || 'none'}</span>
              </div>
            </div>

            {/* Permissions display */}
            {Object.keys(config.permissions).length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {Object.entries(config.permissions).map(([perm, val]) => (
                  <span key={perm} className={`text-[10px] px-2 py-1 rounded-md flex items-center gap-1 ${
                    val ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-400'
                  }`}>
                    {val ? <Check size={10} /> : <X size={10} />} {perm}
                  </span>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Toggle label="Auto-respond to emails" desc="Agent reads and responds to new emails automatically" checked={config.autoRespondToEmail} onChange={() => toggleConfig('autoRespondToEmail')} />
              <Toggle label="Auto-process group invites" desc="Agent auto-joins groups when invited via email" checked={config.autoProcessGroupInvites} onChange={() => toggleConfig('autoProcessGroupInvites')} />
              <Toggle label="Notify on new email" desc="Toast notification when new email arrives" checked={config.notifyOnEmail} onChange={() => toggleConfig('notifyOnEmail')} />
              <Toggle label="Notify on group mention" desc="Alert when @mentioned in a group" checked={config.notifyOnGroupMention} onChange={() => toggleConfig('notifyOnGroupMention')} />
            </div>

            <p className="text-[10px] text-gray-300 mt-3 font-mono">Agents/{name}/config.json</p>
          </div>
        )}

        {/* Audit log panel */}
        {showAudit && (
          <div className="px-5 py-3 border-b border-gray-100 bg-white shrink-0 max-h-[200px] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13px] font-medium text-gray-800 flex items-center gap-2">
                <Activity size={12} /> Audit Log ({auditLogs.length})
              </h3>
              <button onClick={loadAudit} className="text-gray-300 hover:text-gray-500"><RefreshCw size={11} /></button>
            </div>
            {auditLogs.length === 0 ? (
              <p className="text-[11px] text-gray-400 text-center py-4">No audit records</p>
            ) : (
              <div className="space-y-1">
                {auditLogs.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="text-gray-300 font-mono w-[40px]">{e.timestamp?.slice(11, 19)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      e.status === 'error' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-600'
                    }`}>{actionLabel(e.action)}</span>
                    <span className="text-gray-600 truncate flex-1">{e.resource}</span>
                    {e.details && <span className="text-gray-400 truncate max-w-[200px]">{e.details.slice(0, 60)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Chat */}
        <div className="flex-1 min-h-0">
          <ChatPanel agentName={name} />
        </div>
      </main>
    </div>
  );
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 hover:border-gray-200 cursor-pointer transition-colors bg-gray-50/30">
      <div className="relative mt-0.5">
        <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
        <div className={`w-9 h-5 rounded-full transition-colors ${checked ? 'bg-gray-800' : 'bg-gray-200'}`}>
          <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform mt-0.5 ml-0.5 ${checked ? 'translate-x-[14px]' : ''}`} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-gray-800">{label}</p>
        <p className="text-[11px] text-gray-400 leading-snug">{desc}</p>
      </div>
    </label>
  );
}
