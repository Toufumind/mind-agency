'use client';

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight, Brain, Wrench, FileText, ArrowUp } from 'lucide-react';

interface ChatEvent {
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'done' | 'error';
  content?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  timestamp: string;
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  events: ChatEvent[];
  timestamp: string;
}

// Known slash commands with descriptions
const SLASH_COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: '/clear', desc: 'Start a fresh conversation' },
  { cmd: '/compact', desc: 'Compress long context to save tokens' },
  { cmd: '/context', desc: 'View current context window contents' },
  { cmd: '/memory', desc: 'View and edit project memory' },
  { cmd: '/init', desc: 'Initialize or improve CLAUDE.md' },
  { cmd: '/review', desc: 'Review a pull request' },
  { cmd: '/security-review', desc: 'Security audit of changes' },
  { cmd: '/code-review', desc: 'Code review the current diff' },
  { cmd: '/simplify', desc: 'Refactor and clean up code' },
  { cmd: '/debug', desc: 'Debug configuration issues' },
  { cmd: '/verify', desc: 'Verify a change works correctly' },
  { cmd: '/run', desc: 'Launch and test the app' },
  { cmd: '/loop', desc: 'Run a command on repeat interval' },
  { cmd: '/update-config', desc: 'Update Claude Code settings' },
  { cmd: '/fewer-permission-prompts', desc: 'Reduce permission dialogs' },
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
  { cmd: '/workflows', desc: 'View running workflows' },
  { cmd: '/tasks', desc: 'List background tasks' },
];

export default function ChatPanel({ agentName }: { agentName: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCmds, setShowCmds] = useState(false);
  const [cmdFilter, setCmdFilter] = useState('');
  const [cmdIdx, setCmdIdx] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredCmds = SLASH_COMMANDS.filter(c =>
    c.cmd.toLowerCase().startsWith(cmdFilter.toLowerCase())
  );

  useEffect(() => {
    fetch(`/api/agents/${agentName}/chat`)
      .then(r => r.json())
      .then(d => { if (d.messages) setMsgs(d.messages); })
      .catch(() => {});
  }, [agentName]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInput(v);
    if (v.startsWith('/') && !v.includes(' ')) {
      setCmdFilter(v);
      setShowCmds(true);
      setCmdIdx(0);
    } else {
      setShowCmds(false);
    }
  };

  const selectCommand = (cmd: string) => {
    setInput(cmd + ' ');
    setShowCmds(false);
    inputRef.current?.focus();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
    setInput('');
    setShowCmds(false);
    setBusy(true);

    setMsgs(p => [...p, { role: 'user', content: t, events: [], timestamp: new Date().toISOString() }]);
    setMsgs(p => [...p, { role: 'assistant', content: '', events: [], timestamp: new Date().toISOString() }]);

    try {
      const r = await fetch(`/api/agents/${agentName}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: t }),
      });
      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let done = false;

      while (!done) {
        const { done: d, value } = await reader.read();
        if (d) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6);
            if (payload === '[DONE]') { done = true; continue; }
            try {
              const evt: ChatEvent = JSON.parse(payload);
              setMsgs(prev => {
                const next = [...prev];
                const last = { ...next[next.length - 1] };
                last.events = [...last.events, evt];
                if (evt.type === 'text') last.content += evt.content || '';
                if (evt.type === 'done') done = true;
                next[next.length - 1] = last;
                return next;
              });
            } catch {}
          }
        }
      }
    } catch (e) {
      setMsgs(p => {
        const n = [...p];
        const last = { ...n[n.length - 1] };
        last.events = [...last.events, { type: 'error', content: String(e), timestamp: new Date().toISOString() }];
        n[n.length - 1] = last;
        return n;
      });
    }
    setBusy(false);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center text-[10px] font-medium text-gray-500">
            {agentName[0]}
          </div>
          <span className="text-[13px] font-medium text-gray-800">{agentName}</span>
        </div>
        <button
          onClick={async () => { await fetch(`/api/agents/${agentName}/chat`, { method: 'DELETE' }); setMsgs([]); }}
          className="text-[11px] text-gray-300 hover:text-gray-500 transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">
        {msgs.length === 0 && (
          <div className="flex items-center justify-center h-full text-center">
            <p className="text-[13px] text-gray-300">Chat with {agentName}</p>
          </div>
        )}

        {msgs.map((msg, i) => {
          if (msg.role === 'user') {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[70%] bg-gray-50 text-gray-800 rounded-xl px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap">
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
              {!msg.events.some(e => e.type === 'text') && msg.content && (
                <MdText text={msg.content} />
              )}
            </div>
          );
        })}

        {busy && (
          <div className="flex items-center gap-2 text-[12px] text-gray-300 py-1">
            <span className="inline-block w-2 h-2 rounded-full bg-gray-300 animate-pulse" />
            Thinking
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="px-5 py-3 border-t border-gray-100 shrink-0 relative">
        {/* Command suggestions */}
        {showCmds && filteredCmds.length > 0 && (
          <div className="absolute bottom-full left-5 right-5 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-[300px] overflow-y-auto z-20">
            {filteredCmds.map((item, i) => (
              <button
                key={item.cmd}
                onClick={() => selectCommand(item.cmd)}
                className={`w-full text-left px-4 py-2.5 transition-colors flex items-start gap-3 ${
                  i === cmdIdx ? 'bg-gray-50' : 'hover:bg-gray-50/50'
                } ${i === 0 ? 'rounded-t-xl' : ''} ${i === filteredCmds.length - 1 ? 'rounded-b-xl' : ''}`}
              >
                <span className="text-[13px] font-medium text-gray-800 font-mono whitespace-nowrap">{item.cmd}</span>
                <span className="text-[12px] text-gray-400 leading-snug">{item.desc}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            placeholder={`Message ${agentName}...`}
            className="flex-1 bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-[14px] text-gray-800 outline-none focus:border-gray-200 focus:bg-white placeholder:text-gray-300 transition-colors"
            autoFocus
          />
          <button
            onClick={send}
            disabled={!input.trim() || busy}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-20 transition-colors shrink-0"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Markdown text block ──
const mdComponents = {
  code({ node, className, children, ...props }: any) {
    const inline = !className;
    if (inline) {
      return <code className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded text-[12px]" {...props}>{children}</code>;
    }
    return (
      <pre className="bg-gray-50 border border-gray-100 rounded-lg p-3 my-2 overflow-x-auto text-[12px] leading-relaxed">
        <code className={className} {...props}>{children}</code>
      </pre>
    );
  },
  p({ children }: any) { return <p className="my-1.5 leading-relaxed">{children}</p>; },
  ul({ children }: any) { return <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>; },
  ol({ children }: any) { return <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>; },
  li({ children }: any) { return <li className="text-[14px] text-gray-700">{children}</li>; },
  a({ children, href }: any) { return <a href={href} className="text-gray-800 underline underline-offset-2" target="_blank">{children}</a>; },
  blockquote({ children }: any) { return <blockquote className="border-l-2 border-gray-200 pl-3 my-2 text-gray-400 italic">{children}</blockquote>; },
  h1({ children }: any) { return <h1 className="text-[16px] font-semibold text-gray-900 mt-3 mb-1">{children}</h1>; },
  h2({ children }: any) { return <h2 className="text-[15px] font-semibold text-gray-900 mt-3 mb-1">{children}</h2>; },
  h3({ children }: any) { return <h3 className="text-[14px] font-semibold text-gray-900 mt-2 mb-1">{children}</h3>; },
  table({ children }: any) { return <div className="overflow-x-auto my-2"><table className="min-w-full border-collapse text-[13px]">{children}</table></div>; },
  thead({ children }: any) { return <thead className="border-b border-gray-200">{children}</thead>; },
  th({ children }: any) { return <th className="text-left px-2 py-1 text-gray-400 font-medium">{children}</th>; },
  td({ children }: any) { return <td className="px-2 py-1 border-t border-gray-100 text-gray-700">{children}</td>; },
  hr() { return <hr className="border-gray-100 my-3" />; },
  strong({ children }: any) { return <strong className="font-semibold text-gray-900">{children}</strong>; },
  em({ children }: any) { return <em className="italic text-gray-700">{children}</em>; },
};

function MdText({ text }: { text: string }) {
  return (
    <div className="text-[14px] text-gray-700 leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function Think({ text }: { text: string }) {
  const [on, setOn] = useState(true);
  return (
    <div className="text-[12px]">
      <button onClick={() => setOn(!on)}
        className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors group text-left font-mono">
        {on ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Brain size={11} className="text-purple-400" />
        <span>Thinking</span>
      </button>
      {on && <div className="mt-1 ml-6 pl-3 border-l-2 border-gray-100 text-gray-400 leading-relaxed whitespace-pre-wrap">{text}</div>}
    </div>
  );
}

function Tool({ name, input }: { name: string; input: string }) {
  const [on, setOn] = useState(true);
  return (
    <div className="text-[12px]">
      <button onClick={() => setOn(!on)}
        className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors font-mono">
        {on ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Wrench size={11} className="text-blue-400" />
        <span className="font-medium">{name}</span>
      </button>
      {on && <pre className="mt-1 ml-6 pl-3 border-l-2 border-blue-100 text-[11px] text-gray-500 whitespace-pre-wrap max-h-[200px] overflow-y-auto">{input}</pre>}
    </div>
  );
}

function Result({ output }: { output: string }) {
  const [on, setOn] = useState(false);
  return (
    <div className="text-[12px]">
      <button onClick={() => setOn(!on)}
        className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors font-mono">
        {on ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <FileText size={11} className="text-green-500" />
        <span>Result</span>
      </button>
      {on && <pre className="mt-1 ml-6 pl-3 border-l-2 border-green-100 text-[11px] text-gray-500 whitespace-pre-wrap max-h-[200px] overflow-y-auto">{output}</pre>}
    </div>
  );
}

function Err({ text }: { text: string }) {
  return <div className="text-[13px] text-red-400 pl-0">{text}</div>;
}
