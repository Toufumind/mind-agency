'use client';

import { useState, useEffect } from 'react';
import { X, Send } from 'lucide-react';

interface Agent {
  name: string;
  emailCount: number;
}

interface ComposeDialogProps {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
  currentAgent: string;
}

const field =
  'w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-gray-400 transition-colors';

export default function ComposeDialog({ open, onClose, onSent, currentAgent }: ComposeDialogProps) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    if (open) {
      fetch('/api/agents')
        .then(r => r.json())
        .then(data => setAgents(data.agents || []))
        .catch(() => {});
    }
  }, [open]);

  const handleSend = async () => {
    if (!to || !subject) {
      setError('Recipient and subject are required');
      return;
    }
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: currentAgent, to, subject, body }),
      });
      const data = await res.json();
      if (data.success) {
        setTo(''); setSubject(''); setBody('');
        onSent();
      } else {
        setError(data.error || 'Send failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-medium text-gray-900">New message</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-300 hover:text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-3">
          <div className={`${field} bg-gray-50 text-gray-400`}>
            {currentAgent}
          </div>
          <select value={to} onChange={e => setTo(e.target.value)} className={field}>
            <option value="">To...</option>
            {agents.filter(a => a.name !== currentAgent).map(a => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
          </select>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Subject"
            className={field}
          />
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write your message..."
            className={`${field} resize-y min-h-[140px]`}
          />
          {error && (
            <p className="text-[12px] text-red-500">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/50">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-gray-900 text-white text-[13px] font-medium hover:bg-gray-800 disabled:opacity-40 transition-colors"
          >
            <Send size={13} />
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
