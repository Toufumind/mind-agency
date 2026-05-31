'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import ChatPanel from '@/components/chat-panel';
import Sidebar from '@/components/sidebar';
import { Mail, FileText, Hash, Settings, X, RefreshCw, Zap, Shield } from 'lucide-react';

interface Context { agent: string; emails: number; messages: number; groups: string[]; }
interface AgentConfig {
  autoRespondToEmail: boolean;
  autoProcessGroupInvites: boolean;
  notifyOnEmail: boolean;
  notifyOnGroupMention: boolean;
}

const defaultConfig: AgentConfig = {
  autoRespondToEmail: false,
  autoProcessGroupInvites: false,
  notifyOnEmail: true,
  notifyOnGroupMention: true,
};

export default function AgentPage() {
  const { name } = useParams<{ name: string }>();
  const [ctx, setCtx] = useState<Context | null>(null);
  const [showCtx, setShowCtx] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [config, setConfig] = useState<AgentConfig>(defaultConfig);
  const [saving, setSaving] = useState(false);
  const [polling, setPolling] = useState(false);

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
      const agent = (agents.agents || []).find((a: any) => a.name === name);
      setCtx({
        agent: name,
        emails: Array.isArray(emails) ? emails.length : 0,
        messages: chat.messages?.length || 0,
        groups: groups.groups || [],
      });
    }).catch(() => {});
  }, [name]);

  const loadConfig = useCallback(() => {
    fetch(`/api/agents/${name}/config`)
      .then(r => r.json())
      .then(d => { if (!d.error) setConfig({ ...defaultConfig, ...d }); })
      .catch(() => {});
  }, [name]);

  const loadAuditLogs = useCallback(() => {
    setLoadingAudit(true);
    fetch(`/api/audit?agent=${name}&limit=50`)
      .then(r => r.json())
      .then(d => { setAuditLogs(d.logs || []); })
      .catch(() => {})
      .finally(() => setLoadingAudit(false));
  }, [name]);

  useEffect(() => { loadContext(); loadConfig(); }, [loadContext, loadConfig]);

  // Background auto-poll for auto-respond agents (every 30s)
  useEffect(() => {
    if (!config.autoRespondToEmail) return;
    const t = setInterval(() => {
      fetch(`/api/agents/${name}/auto-respond`, { method: 'POST' })
        .then(r => r.json())
        .then(d => { if (d.triggered) setTimeout(loadContext, 2000); })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [config.autoRespondToEmail, name, loadContext]);

  const handlePoll = async () => {
    setPolling(true);
    try {
      const r = await fetch(`/api/agents/${name}/auto-respond`, { method: 'POST' });
      const d = await r.json();
      if (d.triggered) {
        // Reload context after auto-respond
        setTimeout(loadContext, 2000);
      }
    } catch {}
    setPolling(false);
  };

  // Estimate tokens from message count (rough: ~200 tokens per message)
  const tokenEstimate = ctx ? ctx.messages * 200 + ctx.emails * 50 + 20000 : 0;
  const tokenPct = Math.min(100, Math.round((tokenEstimate / 200000) * 100));

  const toggleConfig = async (key: keyof AgentConfig) => {
    const next = { ...config, [key]: !config[key] };
    setConfig(next);
    setSaving(true);
    try {
      await fetch(`/api/agents/${name}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: !config[key] }),
      });
    } catch {}
    setSaving(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        {/* Context bar */}
        {ctx && showCtx && (
          <div className="px-5 py-2.5 border-b border-gray-100 bg-gray-50/50 flex items-center gap-4 shrink-0 text-[12px]">
            <span className="font-medium text-gray-800">{ctx.agent}</span>
            <span className="text-gray-300">·</span>
            <span className="flex items-center gap-1 text-gray-500"><Mail size={11} />{ctx.emails} emails</span>
            <span className="flex items-center gap-1 text-gray-500"><FileText size={11} />{ctx.messages} msgs</span>
            {ctx.groups.length > 0 && <>
              <span className="text-gray-300">·</span>
              <span className="flex items-center gap-1 text-gray-500"><Hash size={11} />{ctx.groups.join(', ')}</span>
            </>}
            {/* Token estimate */}
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${tokenPct > 80 ? 'bg-red-50 text-red-500' : tokenPct > 50 ? 'bg-yellow-50 text-yellow-600' : 'bg-gray-100 text-gray-400'}`}
              title={`~${(tokenEstimate/1000).toFixed(0)}k tokens used (out of 200k)`}>
              ~{(tokenEstimate/1000).toFixed(0)}k
            </span>
            <div className="ml-auto flex items-center gap-2">
              {/* Poll button */}
              <button onClick={handlePoll} disabled={polling}
                className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${polling ? 'text-gray-300' : 'text-green-500 hover:text-green-700 hover:bg-green-50'}`}
                title="Trigger auto-respond for this agent">
                <Zap size={11} className={polling ? 'animate-spin' : ''} /> Poll
              </button>
              <button onClick={loadContext} className="text-gray-300 hover:text-gray-500" title="Refresh"><RefreshCw size={11} /></button>
              <button onClick={() => { setShowAudit(!showAudit); if (!showAudit) loadAuditLogs(); }}
                className={`text-[11px] px-2 py-0.5 rounded-md transition-colors ${showAudit ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <Shield size={12} className="inline mr-1" />Audit Log
              </button>
              <button onClick={() => setShowConfig(!showConfig)}
                className={`text-[11px] px-2 py-0.5 rounded-md transition-colors ${showConfig ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <Settings size={12} className="inline mr-1" />Config
              </button>
              <button onClick={() => setShowCtx(false)} className="text-gray-300 hover:text-gray-500">×</button>
            </div>
          </div>
        )}

        {/* Config panel */}
        {showConfig && (
          <div className="px-5 py-4 border-b border-gray-100 bg-white shrink-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-medium text-gray-800">Agent Configuration</h3>
              {saving && <span className="text-[10px] text-gray-400">saving...</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ConfigToggle label="Auto-respond to emails" desc="When a new email arrives, agent automatically reads and responds" checked={config.autoRespondToEmail} onChange={() => toggleConfig('autoRespondToEmail')} />
              <ConfigToggle label="Auto-process group invites" desc="When invited to a group via email, agent auto-joins" checked={config.autoProcessGroupInvites} onChange={() => toggleConfig('autoProcessGroupInvites')} />
              <ConfigToggle label="Notify on new email" desc="Show a toast notification when new email arrives in inbox" checked={config.notifyOnEmail} onChange={() => toggleConfig('notifyOnEmail')} />
              <ConfigToggle label="Notify on group @mention" desc="Alert when mentioned in a group chat" checked={config.notifyOnGroupMention} onChange={() => toggleConfig('notifyOnGroupMention')} />
            </div>
            <p className="text-[10px] text-gray-300 mt-3 font-mono">
              Config stored at: Agents/{name}/config.json
            </p>
          </div>
        )}

        {/* Audit Log panel */}
        {showAudit && (
          <div className="px-5 py-4 border-b border-gray-100 bg-white shrink-0 max-h-64 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-medium text-gray-800">Audit Log</h3>
              <button onClick={() => { loadAuditLogs(); }} disabled={loadingAudit}
                className={`text-[10px] px-2 py-0.5 rounded ${loadingAudit ? 'text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}>
                <RefreshCw size={11} className={`inline mr-1 ${loadingAudit ? 'animate-spin' : ''}`} />Refresh
              </button>
            </div>
            {auditLogs.length === 0 ? (
              <p className="text-[11px] text-gray-400">No audit logs found for {name}.</p>
            ) : (
              <div className="space-y-1">
                {auditLogs.slice(0, 30).map((entry: any) => (
                  <div key={entry.id} className="text-[11px] font-mono flex gap-2 py-1 border-b border-gray-50 last:border-0">
                    <span className="text-gray-400 shrink-0">{entry.timestamp?.replace('T', ' ').slice(0, 19)}</span>
                    <span className={`shrink-0 w-16 px-1 text-center rounded text-[10px] ${entry.status === 'error' ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}>{entry.action}</span>
                    <span className="text-gray-600 truncate">{entry.resource}</span>
                    {entry.details && <span className="text-gray-400 truncate hidden lg:inline">- {entry.details.slice(0, 60)}</span>}
                  </div>
                ))}
                {auditLogs.length > 30 && (
                  <p className="text-[10px] text-gray-300 pt-1">Showing 30 of {auditLogs.length} entries (latest first)</p>
                )}
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

function ConfigToggle({ label, desc, checked, onChange }: {
  label: string; desc: string; checked: boolean; onChange: () => void;
}) {
  return (
    <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 hover:border-gray-200 cursor-pointer transition-colors">
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
