'use client';

import { User } from 'lucide-react';
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
      <div className="space-y-1">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white border border-gray-200 rounded-lg p-3.5 animate-pulse">
            <div className="h-3.5 bg-gray-100 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-50 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
        <p className="text-sm text-gray-400">No emails yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {emails.map(email => {
        const isSelected = selectedEmail?.filename === email.filename;
        return (
          <button
            key={email.filename}
            onClick={() => onSelect(email)}
            className={`w-full text-left rounded-lg p-3.5 border transition-colors ${
              isSelected
                ? 'bg-gray-50 border-gray-300'
                : 'bg-white border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <h4 className="text-[13px] font-medium text-gray-900 truncate">
                {email.subject}
              </h4>
              {email.date && (
                <span className="text-[11px] text-gray-400 shrink-0">
                  {email.date.slice(5)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 mb-1">
              <User size={11} className="text-gray-300" />
              <span className="text-[11px] text-gray-400">{email.from}</span>
            </div>
            <p className="text-[11px] text-gray-400 line-clamp-2 leading-relaxed">
              {email.body.slice(0, 80)}
            </p>
          </button>
        );
      })}
    </div>
  );
}
