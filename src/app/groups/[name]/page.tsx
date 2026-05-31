'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/sidebar';
import { Hash, Send, Loader2, Users } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMsg { from: string; date: string; body: string; file: string; }

export default function GroupPage() {
  const { name } = useParams<{ name: string }>();
  const router = useRouter();
  const [members, setMembers] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pickAgent, setPickAgent] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const fetchGroup = useCallback(() => {
    setLoading(true);
    fetch(`/api/groups/${name}`)
      .then(r => r.json())
      .then(d => {
        setMembers(d.members || []);
        setMessages(d.messages || []);
        if (!pickAgent && d.members?.length > 0) setPickAgent(d.members[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [name]);

  useEffect(() => { fetchGroup(); }, [fetchGroup]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    const t = input.trim();
    if (!t || sending || !pickAgent) return;
    setInput(''); setSending(true);

    // Send through the selected agent's chat API with group context
    try {
      const body: any = { message: `用 group_send 向 ${name} 群发送消息: ${t}`, group: name };
      const r = await fetch(`/api/agents/${pickAgent}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // Wait for response
      await r.text();
      // Refresh group chat
      setTimeout(fetchGroup, 2000);
    } catch {}
    setSending(false);
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
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-[12px] font-bold text-gray-500">#</span>
            <div>
              <h1 className="text-[15px] font-semibold text-gray-900">{name}</h1>
              <p className="text-[11px] text-gray-400">{members.length} members</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {members.map(m => (
              <button key={m} onClick={() => router.push(`/agents/${m}`)}
                className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-medium text-gray-500 hover:bg-gray-200 transition-colors"
                title={m}>
                {m[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">
          {loading ? (
            <p className="text-[13px] text-gray-300 text-center py-10">Loading...</p>
          ) : messages.length === 0 ? (
            <p className="text-[13px] text-gray-300 text-center py-10">No messages yet</p>
          ) : (
            messages.map((msg, i) => {
              const isSystem = msg.from === 'system';
              return (
                <div key={i} className={`flex ${isSystem ? 'justify-center' : 'items-start gap-3'}`}>
                  {!isSystem && (
                    <button onClick={() => router.push(`/agents/${msg.from}`)}
                      className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-medium text-gray-500 hover:bg-gray-200 transition-colors shrink-0 mt-0.5">
                      {msg.from[0]}
                    </button>
                  )}
                  <div className={isSystem
                    ? 'text-[11px] text-gray-300 italic text-center w-full'
                    : 'flex-1 min-w-0'}>
                    {!isSystem && (
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-[12px] font-medium text-gray-800">{msg.from}</span>
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
            {/* Agent picker */}
            <select value={pickAgent} onChange={e => setPickAgent(e.target.value)}
              className="shrink-0 text-[12px] bg-gray-50 border border-gray-100 rounded-lg px-2 py-2 text-gray-600 outline-none">
              {members.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
              placeholder={`Send as ${pickAgent || '...'}...`}
              disabled={!pickAgent || sending}
              className="flex-1 bg-gray-50 border border-gray-100 rounded-lg px-4 py-2 text-[13px] text-gray-800 outline-none focus:border-gray-200 placeholder:text-gray-300 disabled:opacity-50" />
            <button onClick={send} disabled={!input.trim() || sending || !pickAgent}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-20 transition-colors shrink-0">
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
