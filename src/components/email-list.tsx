'use client';

import { Mail, User, Calendar } from 'lucide-react';
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
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow duration-200 p-4 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-50 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow duration-200 p-12 text-center">
        <div className="flex justify-center mb-3">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gray-50">
            <Mail size={24} className="text-gray-300" />
          </div>
        </div>
        <p className="text-sm font-medium text-gray-500">收件箱为空</p>
        <p className="text-xs text-gray-400 mt-1">还没有人发邮件给这个 Agent</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {emails.map(email => {
        const isSelected = selectedEmail?.filename === email.filename;
        return (
          <button
            key={email.filename}
            onClick={() => onSelect(email)}
            className={`w-full text-left card p-4 transition-all duration-150 ${
              isSelected
                ? 'ring-2 ring-indigo-400 bg-indigo-50/50 border-indigo-100'
                : 'hover:bg-gray-50/80'
            }`}
          >
            <div className="flex items-start justify-between gap-3 mb-1.5">
              <h4 className="text-sm font-semibold text-gray-900 truncate">
                {email.subject}
              </h4>
              {email.date && (
                <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                  {email.date}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
              <span className="flex items-center gap-1">
                <User size={11} />
                {email.from}
              </span>
            </div>
            <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">
              {email.body.slice(0, 120)}
            </p>
          </button>
        );
      })}
    </div>
  );
}
