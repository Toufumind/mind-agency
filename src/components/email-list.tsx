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
          <div key={i} className="bg-canvas border border-border rounded-lg p-3.5 animate-pulse">
            <div className="h-3.5 bg-surface-alt rounded w-3/4 mb-2" />
            <div className="h-3 bg-surface rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="bg-canvas border border-border rounded-lg p-8 text-center">
        <p className="text-sm text-muted-foreground">No emails yet</p>
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
                ? 'bg-surface border-border-strong'
                : 'bg-canvas border-border hover:border-border-strong'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <h4 className="text-[13px] font-medium text-foreground truncate">
                {email.subject}
              </h4>
              {email.date && (
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {email.date.slice(5)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 mb-1">
              <User size={11} className="text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">{email.from}</span>
            </div>
            <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
              {email.body.slice(0, 80)}
            </p>
          </button>
        );
      })}
    </div>
  );
}
