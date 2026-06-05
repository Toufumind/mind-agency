'use client';

import { useState, useEffect, useCallback } from 'react';
import { Mail, Send, Loader2, X, Check, FileText } from 'lucide-react';
import { useT } from './i18n';
import Markdown from './markdown';

interface EmailInfo { from: string; to: string; subject: string; date: string; body: string; filename: string; processed?: boolean; }
interface AgentInfo { name: string; }

interface Props {
  /** Who this email client belongs to. "me" means the human user. */
  agentName: string;
  /** When inside an Agent page, pass the name for the "→" label. Otherwise defaults to "我". */
  displayName?: string;
}

export default function EmailClient({ agentName, displayName }: Props) {
  const { t } = useT();
  const self = displayName || (agentName === 'me' ? t('me') : agentName);
  const STATE_KEY = `email-read-${agentName}`;

  const [emails, setEmails] = useState<EmailInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [readSet, setReadSet] = useState<Set<string>>(new Set());

  const [composing, setComposing] = useState(false);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState('');

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [filter, setFilter] = useState<'inbox' | 'sent'>('inbox');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/emails?agent=${agentName}`).then(r => r.json()),
      fetch('/api/agents').then(r => r.json()),
    ]).then(([emailsData, agentsData]) => {
      setEmails(Array.isArray(emailsData) ? emailsData : []);
      setAgents((agentsData.agents || []).filter((a: any) => a.name !== agentName));
      try { const saved = localStorage.getItem(STATE_KEY); if (saved) setReadSet(new Set(JSON.parse(saved))); } catch {}
    }).catch(() => {}).finally(() => setLoading(false));
  }, [agentName, STATE_KEY]);

  useEffect(() => { load(); }, [load]);

  // ── WS real-time ──
  useEffect(() => {
    let ws: WebSocket | null = null; let stopped = false; let rt: ReturnType<typeof setTimeout>;
    const connect = () => {
      if (stopped) return;
      try {
        ws = new WebSocket(`ws://${window.location.hostname}:3001`);
        ws.onmessage = (e) => { try { const d = JSON.parse(e.data); if (d.type === 'email' && (d.to === agentName || d.from === agentName)) load(); } catch {} };
        ws.onclose = () => { if (!stopped) rt = setTimeout(connect, 3000); };
      } catch { if (!stopped) rt = setTimeout(connect, 3000); }
    };
    connect();
    return () => { stopped = true; clearTimeout(rt); ws?.close(); };
  }, [load]);

  const markRead = (fn: string) => {
    const next = new Set(readSet); next.add(fn);
    setReadSet(next);
    try { localStorage.setItem(STATE_KEY, JSON.stringify([...next])); } catch {}
  };

  // Ensure readSet is loaded from localStorage on mount — critical for persisted state
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STATE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setReadSet(new Set(parsed));
        }
      }
    } catch {}
  }, [STATE_KEY]);

  const sendEmail = async () => {
    if (!to || !subject || sending) return;
    setSending(true); setSentMsg('');
    try {
      const r = await fetch('/api/emails', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: agentName, to, subject, body }) });
      const d = await r.json();
      if (d.success) { setSentMsg(''); setTo(''); setSubject(''); setBody(''); setComposing(false); load(); }
      else setSentMsg(d.error || 'Error');
    } catch { setSentMsg('Network error'); }
    finally { setSending(false); }
  };

  // ── Derived ──
  const isOwn = (e: { from: string }) => e.from.toLowerCase() === agentName.toLowerCase() || (agentName === 'me' && e.from === 'me');
  // For agent pages: "unread" = AI hasn't processed yet. For /me (human): "unread" = user hasn't clicked.
  const isHumanPage = agentName === 'me';
  const unread = emails.filter(e => {
    if (isOwn(e)) return false;
    if (isHumanPage) return !readSet.has(e.filename);
    return e.processed === false; // Agent page: AI hasn't processed yet
  });
  const sent = emails.filter(e => isOwn(e));
  const received = emails.filter(e => !sent.includes(e));

  const listEmails = filter === 'sent' ? sent : received;
  const selectedEmail = selectedFile ? emails.find(e => e.filename === selectedFile) : null;

  const timeFmt = (d: string) => {
    if (!d) return '';
    // Pure date (no time component): show date only
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
      try { return new Date(d + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }); }
      catch { return d; }
    }
    try {
      const t = new Date(d);
      if (isNaN(t.getTime())) return d;
      const now = new Date();
      return (now.getTime() - t.getTime() < 86400000)
        ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : t.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch { return d; }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* ── Top toolbar ── */}
      <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0 bg-canvas">
        <div className="flex items-center gap-2">
          <button onClick={() => { setFilter('inbox'); setSelectedFile(null); }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${filter === 'inbox' ? 'bg-surface-alt text-foreground' : 'text-muted hover:text-foreground'}`}>
            <FileText size={13} /> {t('inbox')} {unread.length > 0 && <span className="text-[10px] bg-primary text-canvas rounded-full w-4 h-4 flex items-center justify-center">{unread.length}</span>}
          </button>
          <button onClick={() => { setFilter('sent'); setSelectedFile(null); }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${filter === 'sent' ? 'bg-surface-alt text-foreground' : 'text-muted hover:text-foreground'}`}>
            <Send size={13} /> {t('sent')}
          </button>
        </div>
        {unread.length > 0 && isHumanPage && (
          <button onClick={() => { const all = new Set(received.filter(e => !readSet.has(e.filename)).map(e => e.filename)); if (all.size === 0) return; const next = new Set([...readSet, ...all]); setReadSet(next); localStorage.setItem(STATE_KEY, JSON.stringify([...next])); }}
            className="text-[11px] text-muted-foreground hover:text-muted flex items-center gap-1"><Check size={12} /> {t('all_read')}</button>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* ── Left: email list (Gmail-style, always visible) ── */}
          <div className="w-[320px] border-r border-border overflow-y-auto shrink-0 bg-surface/30">
            {loading && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground px-4">
                <Loader2 size={20} className="mb-2 animate-spin opacity-30" />
              </div>
            )}
            {!loading && listEmails.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground px-4">
                <Mail size={28} className="mb-2 opacity-30" />
                <p className="text-[12px] text-center">{filter === 'sent' ? t('no_sent') : t('no_emails')}</p>
              </div>
            )}
            {listEmails.map((e) => {
              const isUnread = filter !== 'sent'
                ? (isHumanPage ? !readSet.has(e.filename) : e.processed === false)
                : false;
              const isSelected = selectedFile === e.filename;
              const other = filter === 'sent' ? e.to : e.from;
              return (
                <div key={e.filename}
                  onClick={() => { setSelectedFile(e.filename); markRead(e.filename); }}
                  className={`px-4 py-3 cursor-pointer transition-colors border-b border-border/80 ${isSelected ? 'bg-canvas border-l-[3px] border-l-indigo-500 shadow-sm' : 'hover:bg-canvas/60 border-l-[3px] border-l-transparent'}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[11px] font-bold transition-colors ${isUnread ? 'bg-indigo-100 text-indigo-600 ring-2 ring-indigo-200' : 'bg-surface-alt text-muted-foreground'}`}>
                      {other[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[13px] truncate ${isUnread ? 'font-semibold text-foreground' : 'text-muted'}`}>
                          {other}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{timeFmt(e.date)}</span>
                      </div>
                      <p className={`text-[12px] truncate mt-0.5 ${isUnread ? 'font-medium text-foreground' : 'text-muted'}`}>
                        {e.subject || t('no_subject')}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5 leading-snug">
                        {e.body.slice(0, 80).replace(/\n/g, ' ') + (e.body.length > 80 ? '…' : '')}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

        {/* ── Right: email detail + compose ── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-canvas">
          <div className="px-6 py-3 border-b border-border flex items-center justify-between shrink-0 bg-canvas">
            <h2 className="text-[13px] font-medium text-muted truncate flex-1 mr-4">
              {selectedEmail ? selectedEmail.subject : t('select_contact')}
            </h2>
            <button onClick={() => setComposing(!composing)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-foreground text-canvas rounded-lg hover:opacity-90 transition-colors shrink-0">
              <Send size={11} /> {t('compose')}
            </button>
          </div>

          {/* Compose */}
          {composing && (
            <div className="mx-6 mt-4 p-4 bg-surface rounded-xl border border-border space-y-2.5 shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-muted">{subject.startsWith('Re:') ? t('reply') : t('new_email')} (from: {self})</span>
                <button onClick={() => setComposing(false)} className="text-muted-foreground hover:text-muted"><X size={15} /></button>
              </div>
              <select value={to} onChange={e => setTo(e.target.value)}
                className="w-full px-3 py-2 bg-canvas border border-border rounded-lg text-[12px] outline-none focus:border-border-strong">
                <option value="">{t('to')}...</option>
                {agents.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
              </select>
              <input value={subject} onChange={e => setSubject(e.target.value)} placeholder={t('subject')}
                className="w-full px-3 py-2 bg-canvas border border-border rounded-lg text-[12px] outline-none focus:border-border-strong" />
              <textarea value={body} onChange={e => setBody(e.target.value)} placeholder={t('body') + '...'} rows={4}
                className="w-full px-3 py-2 bg-canvas border border-border rounded-lg text-[12px] outline-none focus:border-border-strong resize-none" />
              {sentMsg && <p className="text-[11px] text-destructive">{sentMsg}</p>}
              <div className="flex justify-end gap-1.5">
                <button onClick={() => setComposing(false)} className="px-3 py-1.5 text-[11px] text-muted hover:bg-surface rounded-lg">{t('cancel')}</button>
                <button onClick={sendEmail} disabled={!to || !subject || sending}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-foreground text-canvas rounded-lg hover:opacity-90 disabled:opacity-30">
                  {sending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} {t('send')}
                </button>
              </div>
            </div>
          )}

          {/* Email detail */}
          <div className="flex-1 overflow-y-auto">
            {!selectedEmail && (
              <div className="flex items-center justify-center h-full text-muted-foreground text-[13px]">
                {t('email_select_hint')}
              </div>
            )}
            {selectedEmail && (
              <div className="px-6 py-5 max-w-3xl">
                {/* Email header */}
                <div className="mb-6">
                  <h1 className="text-[18px] font-semibold text-foreground mb-4">{selectedEmail.subject}</h1>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 text-[13px] font-bold text-indigo-600">
                      {(selectedEmail.from)[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-semibold text-foreground">
                          {selectedEmail.from?.toLowerCase() === agentName.toLowerCase() || (agentName === 'me' && selectedEmail.from === 'me') ? self : selectedEmail.from}
                        </span>
                        <span className="text-[11px] text-muted-foreground">&lt;{selectedEmail.from || agentName}&gt;</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[12px] text-muted">
                        <span>{t('to')}: {selectedEmail.to}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[12px] text-muted-foreground">
                        <span>{timeFmt(selectedEmail.date)}</span>
                      </div>
                    </div>
                    <button onClick={() => { setTo(filter === 'sent' ? selectedEmail.to : selectedEmail.from); setSubject('Re: ' + selectedEmail.subject); setComposing(true); }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-border text-muted hover:bg-surface transition-colors shrink-0">
                      <Send size={10} /> {filter === 'sent' ? t('compose') : t('reply')}
                    </button>
                  </div>
                </div>
                {/* Divider */}
                <div className="border-t border-border pt-5">
                  <div className="text-[14px] text-muted leading-relaxed"><Markdown text={selectedEmail.body} /></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
