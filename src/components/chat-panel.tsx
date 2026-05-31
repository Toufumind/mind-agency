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

export default function ChatPanel({ agentName }: { agentName: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/agents/${agentName}/chat`)
      .then(r => r.json())
      .then(d => { if (d.messages) setMsgs(d.messages); })
      .catch(() => {});
  }, [agentName]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const send = async () => {
    const t = input.trim();
    if (!t || busy) return;
    setInput('');
    setBusy(true);

    setMsgs(p => [...p, { role: 'user', content: t, events: [], timestamp: new Date().toISOString() }]);
    setMsgs(p => [...p, { role: 'assistant', content: '', events: [], timestamp: new Date().toISOString() }]);

    try {
      const r = await fetch(`/api/agents/${agentName}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    <div className="flex flex-col h-full bg-[#0d1117]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#21262d] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-full bg-[#21262d] flex items-center justify-center text-[10px] font-medium text-[#8b949e]">
            {agentName[0]}
          </div>
          <span className="text-[13px] font-medium text-[#e6edf3]">{agentName}</span>
        </div>
        <button
          onClick={async () => { await fetch(`/api/agents/${agentName}/chat`, { method: 'DELETE' }); setMsgs([]); }}
          className="text-[11px] text-[#484f58] hover:text-[#8b949e] transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">
        {msgs.length === 0 && (
          <div className="flex items-center justify-center h-full text-center">
            <p className="text-[13px] text-[#484f58]">Chat with {agentName}</p>
          </div>
        )}

        {msgs.map((msg, i) => {
          if (msg.role === 'user') {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[70%] bg-[#1f2937] text-[#e6edf3] rounded-xl px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap">
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
          <div className="flex items-center gap-2 text-[12px] text-[#484f58] py-1">
            <span className="inline-block w-2 h-2 rounded-full bg-[#484f58] animate-pulse" />
            Thinking
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="px-5 py-3 border-t border-[#21262d] shrink-0">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send(); }}
            placeholder={`Message ${agentName}...`}
            className="flex-1 bg-[#161b22] border border-[#21262d] rounded-lg px-4 py-2.5 text-[14px] text-[#e6edf3] outline-none focus:border-[#30363d] placeholder:text-[#484f58]"
            autoFocus
          />
          <button
            onClick={send}
            disabled={!input.trim() || busy}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#1f2937] text-[#e6edf3] hover:bg-[#30363d] disabled:opacity-30 transition-colors shrink-0"
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
    const isInline = !className;
    if (isInline) {
      return <code className="bg-[#21262d] text-[#e6edf3] px-1.5 py-0.5 rounded text-[12px]" {...props}>{children}</code>;
    }
    return (
      <pre className="bg-[#161b22] border border-[#21262d] rounded-lg p-3 my-2 overflow-x-auto text-[12px] leading-relaxed">
        <code className={className} {...props}>{children}</code>
      </pre>
    );
  },
  p({ children }: any) { return <p className="my-1.5 leading-relaxed">{children}</p>; },
  ul({ children }: any) { return <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>; },
  ol({ children }: any) { return <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>; },
  li({ children }: any) { return <li className="text-[14px] text-[#e6edf3]">{children}</li>; },
  a({ children, href }: any) { return <a href={href} className="text-[#58a6ff] hover:underline" target="_blank">{children}</a>; },
  blockquote({ children }: any) { return <blockquote className="border-l-2 border-[#30363d] pl-3 my-2 text-[#8b949e] italic">{children}</blockquote>; },
  h1({ children }: any) { return <h1 className="text-[16px] font-semibold text-[#e6edf3] mt-3 mb-1">{children}</h1>; },
  h2({ children }: any) { return <h2 className="text-[15px] font-semibold text-[#e6edf3] mt-3 mb-1">{children}</h2>; },
  h3({ children }: any) { return <h3 className="text-[14px] font-semibold text-[#e6edf3] mt-2 mb-1">{children}</h3>; },
  table({ children }: any) { return <div className="overflow-x-auto my-2"><table className="min-w-full border-collapse text-[13px]">{children}</table></div>; },
  thead({ children }: any) { return <thead className="border-b border-[#21262d]">{children}</thead>; },
  th({ children }: any) { return <th className="text-left px-2 py-1 text-[#8b949e] font-medium">{children}</th>; },
  td({ children }: any) { return <td className="px-2 py-1 border-t border-[#21262d] text-[#e6edf3]">{children}</td>; },
  hr() { return <hr className="border-[#21262d] my-3" />; },
  strong({ children }: any) { return <strong className="font-semibold text-[#e6edf3]">{children}</strong>; },
  em({ children }: any) { return <em className="italic text-[#e6edf3]">{children}</em>; },
};

function MdText({ text }: { text: string }) {
  return (
    <div className="text-[14px] text-[#e6edf3] leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

// ── Event components ──
function Think({ text }: { text: string }) {
  const [on, setOn] = useState(true);
  return (
    <div className="text-[12px]">
      <button onClick={() => setOn(!on)}
        className="flex items-center gap-1.5 text-[#8b949e] hover:text-[#c9d1d9] transition-colors group text-left font-mono">
        {on ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Brain size={11} className="text-purple-400" />
        <span>Thinking</span>
      </button>
      {on && <div className="mt-1 ml-6 pl-3 border-l-2 border-[#21262d] text-[#8b949e] leading-relaxed whitespace-pre-wrap">{text}</div>}
    </div>
  );
}

function Tool({ name, input }: { name: string; input: string }) {
  const [on, setOn] = useState(true);
  return (
    <div className="text-[12px]">
      <button onClick={() => setOn(!on)}
        className="flex items-center gap-1.5 text-[#8b949e] hover:text-[#c9d1d9] transition-colors font-mono">
        {on ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Wrench size={11} className="text-blue-400" />
        <span className="font-medium">{name}</span>
      </button>
      {on && <pre className="mt-1 ml-6 pl-3 border-l-2 border-[#1f3a5f] text-[11px] text-[#8b949e] whitespace-pre-wrap max-h-[200px] overflow-y-auto">{input}</pre>}
    </div>
  );
}

function Result({ output }: { output: string }) {
  const [on, setOn] = useState(false);
  return (
    <div className="text-[12px]">
      <button onClick={() => setOn(!on)}
        className="flex items-center gap-1.5 text-[#8b949e] hover:text-[#c9d1d9] transition-colors font-mono">
        {on ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <FileText size={11} className="text-green-400" />
        <span>Result</span>
      </button>
      {on && <pre className="mt-1 ml-6 pl-3 border-l-2 border-[#1f3a3f] text-[11px] text-[#8b949e] whitespace-pre-wrap max-h-[200px] overflow-y-auto">{output}</pre>}
    </div>
  );
}

function Err({ text }: { text: string }) {
  return <div className="text-[13px] text-red-400 pl-0">{text}</div>;
}
