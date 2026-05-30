'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, Terminal, Trash2, Loader2, ChevronDown, ChevronRight, Wrench, Brain, FileText, Check, X as XIcon } from 'lucide-react';

interface ChatEvent {
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'error';
  content: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  timestamp: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  events?: ChatEvent[];
  timestamp: string;
}

interface ChatPanelProps {
  agentName: string;
  onLaunchTerminal?: () => void;
}

export default function ChatPanel({ agentName, onLaunchTerminal }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch(`/api/agents/${agentName}/chat`)
      .then(r => r.json())
      .then(data => { if (data.messages) setMessages(data.messages); })
      .catch(() => {});
  }, [agentName]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setError('');
    setLoading(true);

    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await fetch(`/api/agents/${agentName}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (data.message || data.events) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.message || '',
          events: data.events || [],
          timestamp: new Date().toISOString(),
        }]);
      } else {
        setError(data.error || 'No response');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleClear = async () => {
    await fetch(`/api/agents/${agentName}/chat`, { method: 'DELETE' });
    setMessages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-medium text-gray-500">
            {agentName[0]}
          </span>
          <span className="text-[13px] font-medium text-gray-900">{agentName}</span>
          {loading && <Loader2 size={12} className="animate-spin text-gray-400" />}
        </div>
        <div className="flex items-center gap-1">
          {onLaunchTerminal && (
            <button onClick={onLaunchTerminal}
              className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              title="Open terminal">
              <Terminal size={14} />
            </button>
          )}
          {messages.length > 0 && (
            <button onClick={handleClear}
              className="w-7 h-7 flex items-center justify-center rounded text-gray-300 hover:text-gray-500 hover:bg-gray-50"
              title="Clear">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0 font-mono text-[13px]">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-sm text-gray-400">Start a conversation with {agentName}</p>
              <p className="text-xs text-gray-300 mt-1">
                Ask anything — read email, send messages, run commands
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            {/* User message */}
            {msg.role === 'user' && (
              <div className="flex justify-end mb-4">
                <div className="max-w-[80%] bg-gray-900 text-white rounded-lg px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            )}

            {/* Assistant events — Claude Code style */}
            {msg.role === 'assistant' && msg.events && msg.events.length > 0 && (
              <div className="space-y-1.5 mb-4">
                {msg.events.map((evt, j) => {
                  if (evt.type === 'thinking') {
                    return <ThinkingBlock key={j} content={evt.content} />;
                  }
                  if (evt.type === 'tool_use') {
                    return <ToolUseBlock key={j} toolName={evt.toolName || ''} input={evt.toolInput || ''} />;
                  }
                  if (evt.type === 'tool_result') {
                    return <ToolResultBlock key={j} output={evt.toolOutput || ''} />;
                  }
                  if (evt.type === 'text') {
                    return <div key={j} className="text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap">{evt.content}</div>;
                  }
                  if (evt.type === 'error') {
                    return <ErrorBlock key={j} content={evt.content} />;
                  }
                  return null;
                })}
                {/* Final text response — only if there are no text events (which already displayed) */}
                {msg.content && !msg.events.some(e => e.type === 'text') && (
                  <div className="text-[13px] text-gray-800 leading-relaxed whitespace-pre-wrap mt-2">
                    {msg.content}
                  </div>
                )}
              </div>
            )}

            {/* Fallback: assistant without events */}
            {msg.role === 'assistant' && (!msg.events || msg.events.length === 0) && msg.content && (
              <div className="flex justify-start mb-4">
                <div className="max-w-[80%] bg-gray-100 rounded-lg px-4 py-2.5 text-[13px] text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 text-[12px] text-gray-400 py-1">
              <Loader2 size={13} className="animate-spin" />
              Thinking...
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-start">
            <div className="text-[12px] text-red-500 bg-red-50 px-3 py-1.5 rounded">{error}</div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Input — terminal style */}
      <div className="px-4 py-3 border-t border-gray-200 shrink-0">
        <div className="flex items-end gap-2">
          <span className="text-[13px] text-gray-400 font-mono shrink-0 select-none">▸</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${agentName}...`}
            rows={1}
            className="flex-1 resize-none border-0 outline-none text-[13px] font-mono text-gray-900 placeholder:text-gray-300 py-0 bg-transparent"
            style={{ maxHeight: '120px' }}
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
            autoFocus
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="w-7 h-7 flex items-center justify-center rounded bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-30 transition-colors shrink-0"
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── inline blocks ──

function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[12px]">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Brain size={12} />
        <span>Thinking</span>
      </button>
      {open && (
        <div className="mt-1 ml-5 pl-3 border-l-2 border-gray-200 text-gray-500 leading-relaxed">
          {content}
        </div>
      )}
    </div>
  );
}

function ToolUseBlock({ toolName, input }: { toolName: string; input: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[12px]">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-gray-500 hover:text-gray-700 transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Wrench size={12} className="text-blue-500" />
        <span className="font-medium">{toolName}</span>
      </button>
      {open && (
        <pre className="mt-1 ml-5 pl-3 border-l-2 border-blue-200 text-[11px] text-gray-600 whitespace-pre-wrap font-mono leading-relaxed max-h-[200px] overflow-y-auto">
          {input}
        </pre>
      )}
    </div>
  );
}

function ToolResultBlock({ output }: { output: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[12px]">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-gray-500 hover:text-gray-700 transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <FileText size={12} className="text-green-500" />
        <span>Result</span>
      </button>
      {open && (
        <pre className="mt-1 ml-5 pl-3 border-l-2 border-green-200 text-[11px] text-gray-600 whitespace-pre-wrap font-mono leading-relaxed max-h-[200px] overflow-y-auto">
          {output}
        </pre>
      )}
    </div>
  );
}

function ErrorBlock({ content }: { content: string }) {
  return (
    <div className="text-[12px] flex items-center gap-1.5 text-red-500">
      <XIcon size={12} />
      {content}
    </div>
  );
}
