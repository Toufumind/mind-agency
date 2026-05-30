'use client';

import { useState, useEffect } from 'react';
import { X, Send, Loader2 } from 'lucide-react';

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

const inputClass =
  'w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none transition-all duration-150 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';

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
      setError('请填写收件人和主题');
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
        setTo('');
        setSubject('');
        setBody('');
        onSent();
      } else {
        setError(data.error || '发送失败');
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden animate-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
          <h2 className="text-base font-semibold text-gray-900">撰写邮件</h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-5 space-y-4">
          {/* From */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">发件人</label>
            <div className={`${inputClass} bg-gray-50 text-gray-500`}>
              {currentAgent}
            </div>
          </div>

          {/* To */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">收件人</label>
            <select value={to} onChange={e => setTo(e.target.value)} className={inputClass}>
              <option value="">选择收件人...</option>
              {agents
                .filter(a => a.name !== currentAgent)
                .map(a => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">主题</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="邮件主题..."
              className={inputClass}
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              正文 <span className="text-gray-300 font-normal">(Markdown)</span>
            </label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="写邮件内容...&#10;&#10;支持 Markdown 格式"
              className={`${inputClass} resize-y min-h-[140px]`}
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-150 cursor-pointer bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 active:scale-[0.98]"
          >
            取消
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98] shadow-sm"
          >
            {sending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}
            {sending ? '发送中...' : '发送邮件'}
          </button>
        </div>
      </div>
    </div>
  );
}
