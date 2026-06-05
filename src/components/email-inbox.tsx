'use client';

import { useState, useEffect, useCallback } from 'react';
import { Mail, Send, X, Loader2 } from 'lucide-react';
import { useT } from './i18n';

interface Email { from: string; to: string; subject: string; date: string; body: string; filename: string; }

/** Collapsible email inbox — shows agent's received emails + compose form */
export default function EmailInbox({ agentName }: { agentName: string }) {
  const { t } = useT();
  const [emails, setEmails] = useState<Email[]>([]);
  const [open, setOpen] = useState(true);
  const [composing, setComposing] = useState(false);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    fetch(`/api/emails?agent=${agentName}`).then(r => r.json())
      .then(d => { if (Array.isArray(d)) setEmails(d); }).catch(() => {});
  }, [agentName]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const send = async () => {
    if (!to || !subject || sending) return;
    setSending(true); setSentMsg('');
    try {
      const r = await fetch('/api/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: agentName, to, subject, body }),
      });
      const d = await r.json();
      if (d.success) { setSentMsg(`${t('sent_success')} ${to}`); setTo(''); setSubject(''); setBody(''); load(); }
      else setSentMsg(d.error || '发送失败');
    } catch { setSentMsg('网络错误'); }
    finally { setSending(false); }
  };

  const toggleExpand = (fn: string) => {
    const next = new Set(expanded);
    if (next.has(fn)) next.delete(fn); else next.add(fn);
    setExpanded(next);
  };

  if (!open) return (
    <div className="shrink-0 border-t border-border px-4 py-2">
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-muted transition-colors">
        <Mail size={12} /> {t('inbox')}{emails.length > 0 ? ` (${emails.length})` : ''}
      </button>
    </div>
  );

  return (
    <div className="shrink-0 border-t border-border bg-canvas flex flex-col" style={{ maxHeight: '40vh' }}>
      {/* Header */}
      <div className="px-4 py-2 flex items-center justify-between border-b border-border shrink-0">
        <span className="text-[12px] font-medium text-muted flex items-center gap-1.5">
          <Mail size={12} className="text-muted-foreground" /> {agentName} {t('inbox')} ({emails.length})
        </span>
        <div className="flex items-center gap-2">
          <button onClick={() => setComposing(!composing)}
            className="flex items-center gap-1 text-[10px] bg-surface-alt hover:bg-surface-hover px-2 py-0.5 rounded-md transition-colors">
            <Send size={9} /> {t('compose')}
          </button>
          <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-muted"><X size={14} /></button>
        </div>
      </div>

      {/* Compose */}
      {composing && (
        <div className="px-4 py-3 bg-surface/70 border-b border-border space-y-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-8">To:</span>
            <input value={to} onChange={e => setTo(e.target.value)}
              placeholder="Agent 名字"
              className="flex-1 px-2.5 py-1.5 bg-canvas border border-border rounded-lg text-[12px] outline-none focus:border-border-strong" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-8">{t('subject')}:</span>
            <input value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="邮件主题"
              className="flex-1 px-2.5 py-1.5 bg-canvas border border-border rounded-lg text-[12px] outline-none focus:border-border-strong" />
          </div>
          <textarea value={body} onChange={e => setBody(e.target.value)}
            placeholder="正文..."
            rows={3}
            className="w-full px-2.5 py-1.5 bg-canvas border border-border rounded-lg text-[12px] outline-none focus:border-border-strong resize-none" />
          {sentMsg && (
            <p className={`text-[10px] ${sentMsg.startsWith(t('sent_success')) ? 'text-success' : 'text-destructive'}`}>{sentMsg}</p>
          )}
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setComposing(false)} className="px-3 py-1.5 text-[11px] text-muted-foreground hover:text-muted rounded-lg">{t('cancel')}</button>
            <button onClick={send} disabled={sending || !to || !subject}
              className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-foreground text-canvas rounded-lg hover:opacity-90 disabled:opacity-30 transition-colors">
              {sending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} {t('send')}
            </button>
          </div>
        </div>
      )}

      {/* Email list */}
      <div className="overflow-y-auto flex-1">
        {emails.length === 0 && (
          <div className="px-4 py-10 text-center text-[12px] text-muted-foreground">{t('no_emails')}</div>
        )}
        {emails.map((e) => {
          const isExpanded = expanded.has(e.filename);
          const isOut = e.from === agentName;
          return (
            <div key={e.filename}
              onClick={() => toggleExpand(e.filename)}
              className={`px-4 py-2.5 border-b border-border cursor-pointer hover:bg-surface/50 transition-colors ${isOut ? 'bg-surface/30' : ''}`}>
              <div className="flex items-center gap-2 justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[11px] font-medium ${isOut ? 'text-muted' : 'text-muted'}`}>
                    {isOut ? `→ ${e.to}` : `← ${e.from}`}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{e.date?.slice(0, 10)}</span>
                </div>
                <span className="text-[11px] text-muted font-medium truncate max-w-[40%]">{e.subject}</span>
              </div>
              {isExpanded && (
                <p className="text-[12px] text-muted whitespace-pre-wrap leading-relaxed mt-1.5 pl-0.5">{e.body}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
