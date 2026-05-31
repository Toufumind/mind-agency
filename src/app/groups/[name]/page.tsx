'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/sidebar';
import { Hash, Send, Loader2, Play, CheckCircle, XCircle, Clock, Users, Bot, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMsg { from: string; date: string; body: string; file: string; }
interface WorkflowStep { agent: string; action: string; notify?: string; prompt?: string; condition?: string; }
interface WorkflowDef { name: string; description?: string; steps: WorkflowStep[]; }
interface WorkflowResult { step: string; agent: string; decision: string; reply: string; success: boolean; skipped?: boolean; }

export default function GroupPage() {
  const { name } = useParams<{ name: string }>();
  const router = useRouter();
  const [members, setMembers] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pickAgent, setPickAgent] = useState('');
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [workflow, setWorkflow] = useState<WorkflowDef | null>(null);
  const [wfRunning, setWfRunning] = useState(false);
  const [wfResults, setWfResults] = useState<WorkflowResult[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  const fetchGroup = useCallback(() => {
    setLoading(true);
    fetch(`/api/groups/${name}`).then(r => r.json()).then(d => {
      setMembers(d.members || []);
      setMessages(d.messages || []);
      if (!pickAgent && d.members?.length > 0) setPickAgent(d.members[0]);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [name]);

  const fetchWorkflow = useCallback(() => {
    fetch(`/api/groups/${name}/workflow`).then(r => r.json())
      .then(d => { if (!d.error) setWorkflow(d); }).catch(() => {});
  }, [name]);

  useEffect(() => { fetchGroup(); fetchWorkflow(); }, [fetchGroup, fetchWorkflow]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    const t = input.trim();
    if (!t || sending || !pickAgent) return;
    setInput(''); setSending(true);
    try {
      await fetch(`/api/agents/${pickAgent}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `用 group_send 向 ${name} 群发送消息: ${t}`, group: name }),
      });
      fetchGroup(); // Refresh in background, don't block
    } catch {}
    setSending(false);
  };

  const runWorkflow = async () => {
    if (!workflow || wfRunning) return;
    setWfRunning(true); setWfResults([]);
    try {
      const r = await fetch(`/api/groups/${name}/workflow`, { method: 'POST' });
      const d = await r.json();
      if (d.results) setWfResults(d.results);
      setTimeout(fetchGroup, 3000);
    } catch {}
    setWfRunning(false);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const timeFmt = (d: string) => {
    try { return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch { return d.slice(11, 16); }
  };

  return (
    <div className="flex h-screen bg-white">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center text-[12px] font-bold text-gray-600">#</span>
            <div>
              <h1 className="text-[15px] font-semibold text-gray-900 leading-tight">{name}</h1>
              <p className="text-[11px] text-gray-400">{members.length} members · {messages.length} messages</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Workflow button */}
            {workflow && (
              <button onClick={() => setShowWorkflow(!showWorkflow)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                  showWorkflow ? 'bg-gray-800 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}>
                <Play size={12} /> Workflow
              </button>
            )}
            <button onClick={fetchGroup}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-gray-500 hover:bg-gray-50 transition-colors">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>

        {/* Workflow panel */}
        {showWorkflow && workflow && (
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/30 shrink-0">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-[13px] font-medium text-gray-800 flex items-center gap-2">
                  <Play size={12} /> {workflow.name}
                </h3>
                {workflow.description && <p className="text-[11px] text-gray-400 mt-0.5">{workflow.description}</p>}
              </div>
              <button onClick={runWorkflow} disabled={wfRunning}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50 transition-colors">
                {wfRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                {wfRunning ? 'Running...' : 'Run'}
              </button>
            </div>

            {/* Steps overview */}
            <div className="flex items-center gap-2 mb-3">
              {workflow.steps.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white border border-gray-200 text-[10px]">
                    <Bot size={10} className="text-gray-400" />
                    <span className="text-gray-700">{s.agent}</span>
                    <span className="text-gray-400">{s.action}</span>
                  </div>
                  {i < workflow.steps.length - 1 && <span className="text-gray-300">→</span>}
                </div>
              ))}
            </div>

            {/* Results */}
            {wfResults.length > 0 && (
              <div className="space-y-1.5">
                {wfResults.map((r, i) => (
                  <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[11px] ${
                    r.skipped ? 'bg-gray-50 text-gray-400' :
                    r.decision?.includes('APPROVED') || r.decision?.includes('DEPLOYED') ? 'bg-green-50 text-green-700' :
                    r.decision?.includes('REJECTED') ? 'bg-red-50 text-red-600' : 'bg-white border border-gray-100'
                  }`}>
                    <span className="font-medium w-16">{r.agent}</span>
                    {r.success ? <CheckCircle size={13} className="text-green-500" /> : r.skipped ? <Clock size={13} className="text-gray-300" /> : <XCircle size={13} className="text-red-500" />}
                    <span className="flex-1">{r.decision || r.reply.slice(0, 100)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">
          {loading ? (
            <p className="text-[13px] text-gray-300 text-center py-16">Loading...</p>
          ) : messages.length === 0 ? (
            <div className="text-center py-16">
              <Hash size={32} className="text-gray-200 mx-auto mb-3" />
              <p className="text-[14px] text-gray-400">No messages yet</p>
              <p className="text-[12px] text-gray-300 mt-1">Start the conversation below</p>
            </div>
          ) : (
            messages.map((msg, i) => {
              const isSystem = msg.from === 'system';
              return (
                <div key={i} className={`flex ${isSystem ? 'justify-center' : 'items-start gap-3 group'}`}>
                  {!isSystem && (
                    <button onClick={() => router.push(`/agents/${msg.from}`)}
                      className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-medium text-gray-500 hover:bg-gray-200 transition-colors shrink-0 mt-0.5"
                      title={msg.from}>
                      {msg.from[0]}
                    </button>
                  )}
                  <div className={isSystem ? 'text-[11px] text-gray-300 italic text-center w-full' : 'flex-1 min-w-0'}>
                    {!isSystem && (
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-[12px] font-semibold text-gray-800">{msg.from}</span>
                        <span className="text-[10px] text-gray-300 font-mono">{timeFmt(msg.date)}</span>
                      </div>
                    )}
                    <div className={`text-[13px] leading-relaxed ${isSystem ? 'text-gray-300' : 'text-gray-700'}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.body}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="px-5 py-3 border-t border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <select value={pickAgent} onChange={e => setPickAgent(e.target.value)}
              className="shrink-0 text-[12px] bg-gray-50 border border-gray-100 rounded-xl pl-3 pr-2 py-2.5 text-gray-600 outline-none focus:border-gray-200">
              {members.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <div className="flex-1 flex items-center gap-2 bg-gray-50 rounded-xl px-4 py-2.5 focus-within:bg-white focus-within:ring-2 focus-within:ring-gray-100 transition-all">
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
                placeholder={`Send as ${pickAgent || '...'}...`} disabled={!pickAgent || sending}
                className="flex-1 bg-transparent border-0 outline-none text-[13px] text-gray-800 placeholder:text-gray-300 disabled:opacity-50" />
              <button onClick={send} disabled={!input.trim() || sending || !pickAgent}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-20 transition-colors shrink-0">
                {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
