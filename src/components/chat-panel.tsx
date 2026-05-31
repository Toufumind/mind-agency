'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight, Brain, Wrench, FileText, ArrowUp, Hash } from 'lucide-react';

interface ChatEvent {
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'done' | 'error';
  content?: string; toolName?: string; toolInput?: string; toolOutput?: string; timestamp: string;
}
interface Msg {
  role: 'user' | 'assistant'; content: string; events: ChatEvent[]; timestamp: string;
}
interface AgentInfo { name: string; emailCount: number; }

const SLASH_COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: '/clear', desc: 'Start a fresh conversation' },
  { cmd: '/compact', desc: 'Compress long context to save tokens' },
  { cmd: '/context', desc: 'View current context window contents' },
  { cmd: '/memory', desc: 'View and edit project memory' },
  { cmd: '/init', desc: 'Initialize or improve CLAUDE.md' },
  { cmd: '/review', desc: 'Review a pull request' },
  { cmd: '/code-review', desc: 'Code review the current diff' },
  { cmd: '/simplify', desc: 'Refactor and clean up code' },
  { cmd: '/debug', desc: 'Debug configuration issues' },
  { cmd: '/verify', desc: 'Verify a change works correctly' },
  { cmd: '/run', desc: 'Launch and test the app' },
  { cmd: '/loop', desc: 'Run a command on repeat interval' },
  { cmd: '/agents', desc: 'List configured sub-agents' },
  { cmd: '/hooks', desc: 'View active hook configs' },
  { cmd: '/mcp', desc: 'View connected MCP servers' },
  { cmd: '/permissions', desc: 'View allow/deny rules' },
  { cmd: '/skills', desc: 'List available skills' },
  { cmd: '/doctor', desc: 'Diagnose config problems' },
  { cmd: '/status', desc: 'Active settings sources' },
  { cmd: '/usage', desc: 'Token usage statistics' },
  { cmd: '/help', desc: 'Show help and commands' },
  { cmd: '/version', desc: 'Display Claude Code version' },
  { cmd: '/tasks', desc: 'List background tasks' },
];

export default function ChatPanel({ agentName }: { agentName: string }) {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCmds, setShowCmds] = useState(false);
  const [cmdFilter, setCmdFilter] = useState('');
  const [cmdIdx, setCmdIdx] = useState(0);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredCmds = SLASH_COMMANDS.filter(c => c.cmd.toLowerCase().startsWith(cmdFilter.toLowerCase()));

  useEffect(() => {
    fetch('/api/agents').then(r => r.json()).then(d => setAgents(d.agents || [])).catch(() => {});
    fetch(`/api/agents/${agentName}/chat`)
      .then(r => r.json())
      .then(d => { if (d.messages) setMsgs(d.messages); })
      .catch(() => {});
  }, [agentName]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInput(v);
    if (v.startsWith('/') && !v.includes(' ')) { setCmdFilter(v); setShowCmds(true); setCmdIdx(0); }
    else { setShowCmds(false); }
  };

  const selectCommand = (cmd: string) => { setInput(cmd + ' '); setShowCmds(false); inputRef.current?.focus(); };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showCmds) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCmdIdx(i => Math.min(i + 1, filteredCmds.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCmdIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); if (filteredCmds[cmdIdx]) selectCommand(filteredCmds[cmdIdx].cmd); return; }
      if (e.key === 'Escape') { setShowCmds(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const send = async () => {
    const t = input.trim();
    if (!t || busy) return;
    setInput(''); setShowCmds(false); setBusy(true);
    setMsgs(p => [...p, { role: 'user', content: t, events: [], timestamp: new Date().toISOString() }]);
    setMsgs(p => [...p, { role: 'assistant', content: '', events: [], timestamp: new Date().toISOString() }]);

    try {
      const r = await fetch(`/api/agents/${agentName}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: t }) });
      const reader = r.body!.getReader(); const dec = new TextDecoder(); let buf = ''; let done = false;

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
    <div className="flex flex-col h-full bg-[#0d1117] text-[#e6edf3]">
      {/* Top bar — Claude Code style */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#21262d] shrink-0 select-none">
        <div className="flex items-center gap-3">
          {/* Agent selector */}
          <div className="relative group">
            <button className="flex items-center gap-1.5 text-[12px] font-medium text-[#e6edf3] hover:text-white transition-colors">
              <Hash size={12} className="text-[#8b949e]" />
              {agentName}
              <ChevronDown size={10} className="text-[#484f58]" />
            </button>
            <div className="absolute top-full left-0 mt-1 bg-[#161b22] border border-[#21262d] rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-30 min-w-[160px]">
              {agents.filter(a => a.name !== agentName).map(a => (
                <button key={a.name} onClick={() => router.push(`/agents/${a.name}`)}
                  className="w-full text-left px-3 py-2 text-[12px] text-[#e6edf3] hover:bg-[#21262d] transition-colors first:rounded-t-lg last:rounded-b-lg flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-[#21262d] flex items-center justify-center text-[9px] text-[#8b949e]">{a.name[0]}</span>
                  {a.name}
                </button>
              ))}
              <button onClick={() => router.push('/')}
                className="w-full text-left px-3 py-2 text-[11px] text-[#8b949e] hover:bg-[#21262d] transition-colors last:rounded-b-lg border-t border-[#21262d]">
                + All agents
              </button>
            </div>
          </div>
          {/* model badge */}
          <span className="text-[10px] text-[#484f58] bg-[#161b22] px-1.5 py-0.5 rounded">DeepSeek-V4-Pro</span>
        </div>

        <button onClick={async () => { await fetch(`/api/agents/${agentName}/chat`, { method: 'DELETE' }); setMsgs([]); }}
          className="text-[10px] text-[#484f58] hover:text-[#8b949e] transition-colors">
          /clear
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0 font-sans">
        {msgs.length === 0 && (
          <div className="flex items-center justify-center h-full text-center">
            <div>
              <p className="text-[14px] text-[#8b949e]">Claude Code</p>
              <p className="text-[12px] text-[#484f58] mt-1">Type a message to start</p>
            </div>
          </div>
        )}

        {msgs.map((msg, i) => {
          if (msg.role === 'user') {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[75%] bg-[#161b22] border border-[#21262d] rounded-lg px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-[#e6edf3]">
                  {msg.content}
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
          <div className="flex items-center gap-2 text-[11px] text-[#8b949e] py-1 font-mono">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#8b949e] animate-pulse" />
            Thinking
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input — Claude Code style */}
      <div className="px-5 py-3 border-t border-[#21262d] shrink-0 relative">
        {showCmds && filteredCmds.length > 0 && (
          <div className="absolute bottom-full left-5 right-5 mb-1 bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl max-h-[300px] overflow-y-auto z-20">
            {filteredCmds.map((item, i) => (
              <button key={item.cmd} onClick={() => selectCommand(item.cmd)}
                className={`w-full text-left px-4 py-2.5 transition-colors flex items-start gap-3 ${i === cmdIdx ? 'bg-[#1f6feb]/20' : 'hover:bg-[#21262d]'}`}>
                <span className="text-[13px] font-medium text-[#e6edf3] font-mono whitespace-nowrap">{item.cmd}</span>
                <span className="text-[12px] text-[#8b949e] leading-snug">{item.desc}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-[14px] text-[#484f58] font-mono select-none">{'>'}</span>
          <input ref={inputRef} value={input} onChange={handleInputChange} onKeyDown={handleKeyDown}
            placeholder={`Message ${agentName}...`}
            className="flex-1 bg-transparent border-0 outline-none text-[14px] text-[#e6edf3] placeholder:text-[#484f58]"
            autoFocus />
          <button onClick={send} disabled={!input.trim() || busy}
            className="w-7 h-7 flex items-center justify-center rounded-md bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d] disabled:opacity-20 transition-colors shrink-0">
            <ArrowUp size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Markdown text block — Claude Code style ──
const mdComponents = {
  code({ className, children, ...props }: any) {
    if (!className) return <code className="bg-[#161b22] text-[#e6edf3] px-1.5 py-0.5 rounded text-[12px] font-mono">{children}</code>;
    return <pre className="bg-[#161b22] border border-[#21262d] rounded-lg p-3 my-2 overflow-x-auto text-[12px] leading-relaxed font-mono"><code className={className} {...props}>{children}</code></pre>;
  },
  p({ children }: any) { return <p className="my-1.5 leading-relaxed">{children}</p>; },
  ul({ children }: any) { return <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>; },
  ol({ children }: any) { return <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>; },
  li({ children }: any) { return <li className="text-[14px]">{children}</li>; },
  a({ children, href }: any) { return <a href={href} className="text-[#58a6ff] hover:underline" target="_blank">{children}</a>; },
  blockquote({ children }: any) { return <blockquote className="border-l-2 border-[#30363d] pl-3 my-2 text-[#8b949e] italic">{children}</blockquote>; },
  h1({ children }: any) { return <h1 className="text-[16px] font-semibold mt-3 mb-1">{children}</h1>; },
  h2({ children }: any) { return <h2 className="text-[15px] font-semibold mt-3 mb-1">{children}</h2>; },
  h3({ children }: any) { return <h3 className="text-[14px] font-semibold mt-2 mb-1">{children}</h3>; },
  table({ children }: any) { return <div className="overflow-x-auto my-2"><table className="min-w-full border-collapse text-[13px]">{children}</table></div>; },
  thead({ children }: any) { return <thead className="border-b border-[#21262d]">{children}</thead>; },
  th({ children }: any) { return <th className="text-left px-2 py-1 text-[#8b949e] font-medium">{children}</th>; },
  td({ children }: any) { return <td className="px-2 py-1 border-t border-[#21262d]">{children}</td>; },
  hr() { return <hr className="border-[#21262d] my-3" />; },
  strong({ children }: any) { return <strong className="font-semibold text-[#f0f6fc]">{children}</strong>; },
  em({ children }: any) { return <em className="italic">{children}</em>; },
};

function MdText({ text }: { text: string }) {
  return <div className="text-[14px] leading-relaxed"><ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{text}</ReactMarkdown></div>;
}

function Think({ text }: { text: string }) {
  const [on, setOn] = useState(false);
  return (
    <div className="text-[12px] font-mono">
      <button onClick={() => setOn(!on)} className="flex items-center gap-1.5 text-[#8b949e] hover:text-[#c9d1d9] transition-colors text-left">
        {on ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Brain size={11} className="text-purple-400" />
        <span>Thinking</span>
      </button>
      {on && <div className="mt-1 ml-6 pl-3 border-l-2 border-purple-500/20 text-[#8b949e] leading-relaxed whitespace-pre-wrap">{text}</div>}
    </div>
  );
}

function Tool({ name, input }: { name: string; input: string }) {
  const [on, setOn] = useState(false);
  return (
    <div className="text-[12px] font-mono">
      <button onClick={() => setOn(!on)} className="flex items-center gap-1.5 text-[#8b949e] hover:text-[#c9d1d9] transition-colors text-left">
        {on ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Wrench size={11} className="text-blue-400" />
        <span className="font-medium">{name}</span>
      </button>
      {on && <pre className="mt-1 ml-6 pl-3 border-l-2 border-blue-500/20 text-[11px] text-[#8b949e] whitespace-pre-wrap max-h-[200px] overflow-y-auto">{input}</pre>}
    </div>
  );
}

function Result({ output }: { output: string }) {
  const [on, setOn] = useState(false);
  return (
    <div className="text-[12px] font-mono">
      <button onClick={() => setOn(!on)} className="flex items-center gap-1.5 text-[#8b949e] hover:text-[#c9d1d9] transition-colors text-left">
        {on ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <FileText size={11} className="text-green-400" />
        <span>Result</span>
      </button>
      {on && <pre className="mt-1 ml-6 pl-3 border-l-2 border-green-500/20 text-[11px] text-[#8b949e] whitespace-pre-wrap max-h-[200px] overflow-y-auto">{output}</pre>}
    </div>
  );
}

function Err({ text }: { text: string }) {
  return <div className="text-[13px] text-red-400">{text}</div>;
}
