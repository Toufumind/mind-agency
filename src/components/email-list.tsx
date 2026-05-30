'use client';

import { Mail, User } from 'lucide-react';
import type { Email } from '@/types';

interface EmailListProps {
  emails: Email[];
  selectedEmail: Email | null;
  onSelect: (email: Email) => void;
  loading?: boolean;
}

export default function EmailList({ emails, selectedEmail, onSelect, loading }: EmailListProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse"
          >
            <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-50 rounded w-1/2 mb-2" />
            <div className="h-3 bg-gray-50 rounded w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
        <div className="flex justify-center mb-3">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gray-50">
            <Mail size={22} className="text-gray-300" />
          </div>
        </div>
        <p className="text-sm font-medium text-gray-500">收件箱为空</p>
        <p className="text-xs text-gray-400 mt-1">还没有收到任何邮件</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {emails.map(email => {
        const isSelected = selectedEmail?.filename === email.filename;
        return (
          <button
            key={email.filename}
            onClick={() => onSelect(email)}
            className={`w-full text-left rounded-2xl p-4 transition-all duration-150 ${
              isSelected
                ? 'bg-indigo-50/80 ring-2 ring-indigo-400 shadow-sm'
                : 'bg-white border border-gray-100 hover:bg-gray-50/80 hover:border-gray-200 shadow-sm'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <h4 className={`text-sm font-semibold truncate ${
                isSelected ? 'text-indigo-900' : 'text-gray-900'
              }`}>
                {email.subject}
              </h4>
              {email.date && (
                <span className="text-[10px] text-gray-400 shrink-0 mt-0.5">
                  {new Date(email.date).toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <User size={11} className="text-gray-300" />
              <span className="text-[11px] text-gray-400">{email.from}</span>
            </div>
            <p className="text-[11px] text-gray-400 line-clamp-2 leading-relaxed">
              {email.body.slice(0, 100)}
            </p>
          </button>
        );
      })}
    </div>
  );
}
