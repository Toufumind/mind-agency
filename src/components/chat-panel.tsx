'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight, Brain, Wrench, FileText, ArrowUp, Mail, Users as UsersIcon } from 'lucide-react';

interface ChatEvent { type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'done' | 'error'; content?: string; toolName?: string; toolInput?: string; toolOutput?: string; timestamp: string; }
interface Msg { role: 'user' | 'assistant' | 'system'; content: string; events: ChatEvent[]; timestamp: string; }
interface AgentInfo { name: string; emailCount: number; }

// Slash commands that the web can handle locally (no Claude Code shell needed)
const COMMANDS: { cmd: string; desc: string; handler?: (agentName: string) => Promise<string> | string }[] = [
  { cmd: '/clear', desc: 'Clear chat history', handler: () => '' },
  { cmd: '/memory', desc: 'Show loaded rules and session info', handler: memoryCmd },
  { cmd: '/help', desc: 'Show available commands', handler: helpCmd },
  { cmd: '/version', desc: 'Show version info', handler: () => '**Mind Agency** v0.2.0 · Claude Code CLI 2.1.158 · DeepSeek-V4-Pro' },
];

async function memoryCmd(agentName: string) {
  const parts: string[] = ['## /memory'];
  // Fetch agent info
  try {
    const r = await fetch('/api/agents');
    const d = await r.json();
    const agent = (d.agents || []).find((a: any) => a.name === agentName);
    if (agent) {
      parts.push(`\n**Agent:** ${agent.name}`);
      parts.push(`Emails: ${agent.emailCount}`);
    }
  } catch {}
  // Fetch chat history length
  try {
    const r = await fetch(`/api/agents/${agentName}/chat`);
    const d = await r.json();
    const count = d.messages?.length || 0;
    parts.push(`Messages: ${count}`);
  } catch {}
  // Fetch groups
  try {
    const r = await fetch(`/api/groups/scan?agent=${agentName}`);
    const d = await r.json();
    parts.push(`Groups: ${(d.groups || []).join(', ') || 'none'}`);
  } catch {}
  parts.push(`\n\`\`\`\nCLAUDE.md loaded from project root + Agents/${agentName}/\n\`\`\``);
  return parts.join('\n');
}

function helpCmd() {
  return COMMANDS.map(c => `- **${c.cmd}** — ${c.desc}`).join('\n');
}

export default function ChatPanel({ agentName }: { agentName: string }) {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCmds, setShowCmds] = useState(false);
  const [cmdFilter, setCmdFilter] = useState('');
  const [cmdIdx, setCmdIdx] = useState(0);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [emailCount, setEmailCount] = useState(0);
  const [toastMsg, setToastMsg] = useState('');
  const [activeGroup, setActiveGroup] = useState('');
  const [myGroups, setMyGroups] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredCmds = COMMANDS.filter(c => c.cmd.startsWith(cmdFilter));

  const checkEmails = useCallback(async () => {
    try {
      const r = await fetch(`/api/emails?agent=${agentName}`);
      const emails = await r.json();
      if (Array.isArray(emails) && emails.length > emailCount && emailCount > 0) {
        setToastMsg(`${emails[0].from}: ${emails[0].subject}`);
        setTimeout(() => setToastMsg(''), 4000);
      }
      setEmailCount(Array.isArray(emails) ? emails.length : 0);
    } catch {}
  }, [agentName, emailCount]);

  const loadGroups = useCallback(async () => {
    try {
      const r = await fetch('/api/groups/scan?agent=' + agentName);
      setMyGroups((await r.json()).groups || []);
    } catch {}
  }, [agentName]);

  useEffect(() => {
    fetch('/api/agents').then(r => r.json()).then(d => setAgents(d.agents || [])).catch(() => {});
    fetch(`/api/agents/${agentName}/chat`)
      .then(r => r.json()).then(d => { if (d.messages) setMsgs(d.messages); }).catch(() => {});
    fetch(`/api/emails?agent=${agentName}`).then(r => r.json())
      .then(d => { if (Array.isArray(d)) setEmailCount(d.length); }).catch(() => {});
    loadGroups();
  }, [agentName]);

  useEffect(() => {
    const t = setInterval(checkEmails, 10000);
    return () => clearInterval(t);
  }, [checkEmails]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value; setInput(v);
    if (v.startsWith('/') && !v.includes(' ')) { setCmdFilter(v); setShowCmds(true); setCmdIdx(0); }
    else setShowCmds(false);
  };
  const selectCmd = (cmd: string) => { setInput(cmd + ' '); setShowCmds(false); inputRef.current?.focus(); };
  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showCmds) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCmdIdx(i => Math.min(i + 1, filteredCmds.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCmdIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); if (filteredCmds[cmdIdx]) selectCmd(filteredCmds[cmdIdx].cmd); return; }
      if (e.key === 'Escape') { setShowCmds(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const send = async () => {
    const t = input.trim();
    if (!t || busy) return;
    setInput(''); setShowCmds(false);

    // ── Intercept slash commands ──
    const m = t.match(/^(\/\w+)/);
    if (m) {
      const cmd = COMMANDS.find(c => c.cmd === m[1]);
      if (cmd?.handler) {
        if (cmd.cmd === '/clear') {
          await fetch(`/api/agents/${agentName}/chat`, { method: 'DELETE' });
          setMsgs([]);
          return;
        }
        const result = await cmd.handler(agentName);
        setMsgs(p => [...p,
          { role: 'user', content: t, events: [], timestamp: new Date().toISOString() },
          { role: 'system', content: result, events: [], timestamp: new Date().toISOString() },
        ]);
        return;
      }
    }

    setBusy(true);
    setMsgs(p => [...p, { role: 'user', content: t, events: [], timestamp: new Date().toISOString() }]);
    setMsgs(p => [...p, { role: 'assistant', content: '', events: [], timestamp: new Date().toISOString() }]);
    try {
      const body: any = { message: t };
      if (activeGroup) body.group = activeGroup;
      const r = await fetch(`/api/agents/${agentName}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const reader = r.body!.getReader(); const dec = new TextDecoder(); let buf = '', done = false;
      while (!done) {
        const { done: d, value } = await reader.read();
        if (d) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() || '';
        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const p = line.slice(6);
            if (p === '[DONE]') { done = true; continue; }
            try {
              const evt: ChatEvent = JSON.parse(p);
              setMsgs(prev => { const n = [...prev]; const l = { ...n[n.length - 1] }; l.events = [...l.events, evt]; if (evt.type === 'text') l.content += evt.content || ''; n[n.length - 1] = l; return n; });
            } catch {}
          }
        }
      }
    } catch (e) {
      setMsgs(p => { const n = [...p]; const l = { ...n[n.length - 1] }; l.events = [...l.events, { type: 'error', content: String(e), timestamp: new Date().toISOString() }]; n[n.length - 1] = l; return n; });
    }
    setBusy(false); inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {toastMsg && (
        <div className="fixed top-4 right-4 z-50 bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-lg animate-in flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center"><Mail size={14} className="text-gray-500" /></div>
          <div><p className="text-[11px] text-gray-400">New email</p><p className="text-[13px] text-gray-800 font-medium">{toastMsg}</p></div>
        </div>
      )}

      <div className="flex items-center justify-between px-5 py-3 shrink-0 select-none">
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-medium text-gray-900">{agentName}</span>
          {activeGroup && (
            <span className="inline-flex items-center gap-1 text-[11px] text-white bg-gray-800 px-2.5 py-0.5 rounded-md">
              <UsersIcon size={10} />{activeGroup}
              <button onClick={() => { setActiveGroup(''); setMsgs([]); }} className="ml-1 text-white/50 hover:text-white">×</button>
            </span>
          )}
          {myGroups.length > 0 && !activeGroup && (
            <div className="relative group">
              <button className="text-[11px] text-gray-400 bg-gray-50 hover:bg-gray-100 px-2.5 py-0.5 rounded-md transition-colors flex items-center gap-1">
                <UsersIcon size={10} />Groups<ChevronDown size={8} />
              </button>
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-30 py-1 min-w-[140px]">
                {myGroups.map(g => (
                  <button key={g} onClick={() => { setActiveGroup(g); setMsgs([]); }} className="w-full text-left px-4 py-2 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors">{g}</button>
                ))}
              </div>
            </div>
          )}
          {emailCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-gray-50 px-2 py-0.5 rounded-md"><Mail size={10} />{emailCount}</span>
          )}
        </div>
        <button onClick={async () => { await fetch(`/api/agents/${agentName}/chat`, { method: 'DELETE' }); setMsgs([]); }}
          className="text-[11px] text-gray-300 hover:text-gray-500 transition-colors">Clear</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6 min-h-0">
        {msgs.length === 0 && (
          <div className="flex items-center justify-center h-full text-center">
            <div>
              <p className="text-[15px] text-gray-400 font-medium">Mind Agency</p>
              <p className="text-[13px] text-gray-300 mt-1">Start a conversation with {agentName}</p>
              <p className="text-[12px] text-gray-300 mt-2">Try <code className="text-gray-400">/help</code> for commands</p>
            </div>
          </div>
        )}
        {msgs.map((msg, i) => {
          if (msg.role === 'user') {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[75%] bg-gray-50 text-gray-800 rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            );
          }
          if (msg.role === 'system') {
            return (
              <div key={i} className="flex justify-start">
                <div className="max-w-[85%] bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 text-[13px] text-gray-700 leading-relaxed font-mono">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{msg.content}</ReactMarkdown>
                </div>
              </div>
            );
          }
          return (
            <div key={i} className="space-y-2">
              {msg.events.map((evt, j) => {
                if (evt.type === 'thinking') return <Think key={j} text={evt.content || ''} />;
                if (evt.type === 'tool_use') return <Tool key={j} name={evt.toolName || ''} input={evt.toolInput || ''} />;
                if (evt.type === 'tool_result') return <Result key={j} output={evt.toolOutput || ''} />;
                if (evt.type === 'text') return <MdText key={j} text={evt.content || ''} />;
                if (evt.type === 'error') return <Err key={j} text={evt.content || ''} />;
                return null;
              })}
              {!msg.events.some(e => e.type === 'text') && msg.content && <MdText text={msg.content} />}
            </div>
          );
        })}
        {busy && (
          <div className="flex items-center gap-2 text-[12px] text-gray-300 py-1">
            <span className="inline-block w-[6px] h-[6px] rounded-full bg-gray-300 animate-pulse" />Thinking
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="px-5 py-3 shrink-0 relative">
        {showCmds && filteredCmds.length > 0 && (
          <div className="absolute bottom-full left-5 right-5 mb-1 bg-white border border-gray-200 rounded-2xl shadow-xl max-h-[280px] overflow-y-auto z-20 py-1">
            {filteredCmds.map((item, i) => (
              <button key={item.cmd} onClick={() => selectCmd(item.cmd)}
                className={`w-full text-left px-4 py-2.5 transition-colors flex items-start gap-3 ${i === cmdIdx ? 'bg-gray-50' : 'hover:bg-gray-50/50'}`}>
                <span className="text-[13px] font-medium text-gray-800 font-mono whitespace-nowrap">{item.cmd}</span>
                <span className="text-[12px] text-gray-400 leading-snug">{item.desc}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 bg-gray-50 rounded-2xl px-4 py-2.5 focus-within:bg-white focus-within:ring-2 focus-within:ring-gray-100 transition-all">
          <input ref={inputRef} value={input} onChange={handleChange} onKeyDown={handleKey}
            placeholder={`Message ${agentName}...`}
            className="flex-1 bg-transparent border-0 outline-none text-[14px] text-gray-800 placeholder:text-gray-300"
            autoFocus />
          <button onClick={send} disabled={!input.trim() || busy}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-20 transition-colors shrink-0">
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Markdown ──
const mdComponents = {
  code({ className, children, ...props }: any) {
    if (!className) return <code className="bg-red-50 text-red-500 px-1.5 py-0.5 rounded text-[12px]" {...props}>{children}</code>;
    return <pre className="bg-gray-50 border border-gray-100 rounded-xl p-4 my-2 overflow-x-auto text-[13px] leading-relaxed"><code className={className} {...props}>{children}</code></pre>;
  },
  p({ children }: any) { return <p className="my-1 leading-relaxed">{children}</p>; },
  ul({ children }: any) { return <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>; },
  li({ children }: any) { return <li className="text-[14px] text-gray-700">{children}</li>; },
  a({ children, href }: any) { return <a href={href} className="text-gray-800 underline underline-offset-2" target="_blank">{children}</a>; },
  blockquote({ children }: any) { return <blockquote className="border-l-2 border-gray-200 pl-3 my-2 text-gray-400">{children}</blockquote>; },
  h2({ children }: any) { return <h2 className="text-[15px] font-semibold text-gray-900 mt-3 mb-1">{children}</h2>; },
  h3({ children }: any) { return <h3 className="text-[14px] font-semibold text-gray-900 mt-2 mb-1">{children}</h3>; },
  strong({ children }: any) { return <strong className="font-semibold text-gray-900">{children}</strong>; },
  em({ children }: any) { return <em className="italic">{children}</em>; },
};

function MdText({ text }: { text: string }) {
  return <div className="text-[14px] text-gray-700 leading-relaxed"><ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{text}</ReactMarkdown></div>;
}
function Think({ text }: { text: string }) {
  const [on, setOn] = useState(false);
  return (
    <div className="text-[12px]">
      <button onClick={() => setOn(!on)} className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors text-left">
        {on ? <ChevronDown size={11} /> : <ChevronRight size={11} />}<Brain size={11} className="text-purple-400" /> Thinking
      </button>
      {on && <div className="mt-1 ml-6 pl-3 border-l-2 border-gray-100 text-gray-400 leading-relaxed whitespace-pre-wrap">{text}</div>}
    </div>
  );
}
function Tool({ name, input }: { name: string; input: string }) {
  const [on, setOn] = useState(false);
  return (
    <div className="text-[12px]">
      <button onClick={() => setOn(!on)} className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors text-left">
        {on ? <ChevronDown size={11} /> : <ChevronRight size={11} />}<Wrench size={11} className="text-blue-400" /> {name}
      </button>
      {on && <pre className="mt-1 ml-6 pl-3 border-l-2 border-gray-100 text-[11px] text-gray-400 whitespace-pre-wrap max-h-[200px] overflow-y-auto">{input}</pre>}
    </div>
  );
}
function Result({ output }: { output: string }) {
  const [on, setOn] = useState(false);
  return (
    <div className="text-[12px]">
      <button onClick={() => setOn(!on)} className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors text-left">
        {on ? <ChevronDown size={11} /> : <ChevronRight size={11} />}<FileText size={11} className="text-green-500" /> Result
      </button>
      {on && <pre className="mt-1 ml-6 pl-3 border-l-2 border-gray-100 text-[11px] text-gray-400 whitespace-pre-wrap max-h-[200px] overflow-y-auto">{output}</pre>}
    </div>
  );
}
function Err({ text }: { text: string }) { return <div className="text-[13px] text-red-400">{text}</div>; }
