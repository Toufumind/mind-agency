'use client';

import { User, Calendar, Mail, Trash2, X } from 'lucide-react';
import type { Email } from '@/types';

interface EmailViewerProps {
  email: Email;
  onClose: () => void;
  onDelete: (email: Email) => void;
  agentName: string;
}

export default function EmailViewer({ email, onClose, onDelete, agentName }: EmailViewerProps) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 min-w-0">
          <Mail size={15} className="text-indigo-500 shrink-0" />
          <span className="truncate">{email.subject}</span>
        </h3>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onDelete(email)}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="删除"
          >
            <Trash2 size={15} />
          </button>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="关闭"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Meta */}
      <div className="px-6 py-4 bg-white border-b border-gray-50">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <User size={13} className="text-gray-300" />
            <span className="text-gray-400">发件人</span>
            <span className="font-semibold text-gray-700">{email.from}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400">收件人</span>
            <span className="font-semibold text-gray-700">{email.to}</span>
          </div>
          {email.date && (
            <div className="flex items-center gap-1.5">
              <Calendar size={13} className="text-gray-300" />
              <span className="text-gray-400">日期</span>
              <span className="font-semibold text-gray-700">
                {new Date(email.date).toLocaleDateString('zh-CN', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </div>
          )}
        </div>
        <div className="mt-2 text-[11px] text-gray-400 font-mono">
          {email.filename}
        </div>
      </div>

      {/* Body */}
      <div className="px-6 py-8">
        <div className="prose prose-sm prose-gray max-w-none whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
          {email.body}
        </div>
      </div>
    </div>
  );
}
