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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Mail size={15} className="text-indigo-500" />
          {email.subject}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onDelete(email)}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50"
            title="删除"
          >
            <Trash2 size={15} />
          </button>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            title="关闭"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Meta */}
      <div className="px-6 py-4 bg-white border-b border-gray-50">
        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <User size={13} />
            <span className="text-gray-400">发件人</span>
            <span className="font-semibold text-gray-700">{email.from}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400">收件人</span>
            <span className="font-semibold text-gray-700">{email.to}</span>
          </div>
          {email.date && (
            <div className="flex items-center gap-1.5">
              <Calendar size={13} />
              <span className="text-gray-400">日期</span>
              <span className="font-semibold text-gray-700">{email.date}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400">文件</span>
            <code className="text-[11px] font-mono bg-gray-100 px-1.5 py-0.5 rounded">
              {email.filename}
            </code>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-6 py-6">
        <div className="prose prose-sm prose-gray max-w-none whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
          {email.body}
        </div>
      </div>
    </div>
  );
}
