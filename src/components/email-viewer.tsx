'use client';

import { Trash2, X } from 'lucide-react';
import type { Email } from '@/types';

interface EmailViewerProps {
  email: Email;
  onClose: () => void;
  onDelete: (email: Email) => void;
  agentName: string;
}

export default function EmailViewer({ email, onClose, onDelete }: EmailViewerProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <h3 className="text-sm font-medium text-gray-900 truncate mr-2">{email.subject}</h3>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onDelete(email)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-300 hover:text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Meta */}
      <div className="px-5 py-3 border-b border-gray-50">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-gray-500">
          <span>From <span className="font-medium text-gray-700">{email.from}</span></span>
          <span>To <span className="font-medium text-gray-700">{email.to}</span></span>
          {email.date && (
            <span>
              {new Date(email.date).toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              })}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-gray-300 font-mono">{email.filename}</p>
      </div>

      {/* Body */}
      <div className="px-5 py-6">
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
          {email.body}
        </div>
      </div>
    </div>
  );
}
