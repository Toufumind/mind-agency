'use client';

import { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import Sidebar from '@/components/sidebar';
import { Mail, X } from 'lucide-react';
import type { Email } from '@/types';

const Terminal = dynamic(() => import('@/components/terminal'), { ssr: false });

export default function AgentPage() {
  const params = useParams();
  const agentName = params.name as string;

  const [showEmails, setShowEmails] = useState(false);
  const [emails, setEmails] = useState<Email[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);

  const fetchEmails = useCallback(() => {
    setEmailsLoading(true);
    fetch(`/api/emails?agent=${agentName}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setEmails(data); })
      .catch(() => {})
      .finally(() => setEmailsLoading(false));
  }, [agentName]);

  const handleToggleEmails = () => {
    if (!showEmails) fetchEmails();
    setShowEmails(!showEmails);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#0d1117]">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-gray-800 shrink-0 bg-[#0d1117]">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-500 hover:text-gray-300 transition-colors">
              <span className="text-sm">←</span>
            </Link>
            <span className="text-[12px] text-gray-500 font-mono">
              Agents/{agentName}/
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleEmails}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] transition-colors ${
                showEmails
                  ? 'bg-gray-800 text-gray-200'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
              }`}
            >
              <Mail size={13} />
              Inbox
              {emails.length > 0 && <span className="text-gray-500">({emails.length})</span>}
            </button>
          </div>
        </div>

        {/* Main: Terminal */}
        <div className="flex-1 flex overflow-hidden min-h-0 p-4">
          <div className="flex-1 min-w-0">
            <Terminal agentName={agentName} />
          </div>

          {/* Email drawer */}
          {showEmails && (
            <div className="w-[360px] border-l border-gray-800 flex flex-col shrink-0 bg-[#161b22] ml-4 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800">
                <h3 className="text-[13px] font-medium text-gray-200 flex items-center gap-1.5">
                  <Mail size={13} className="text-gray-500" />
                  Inbox
                  {!emailsLoading && <span className="text-gray-500">({emails.length})</span>}
                </h3>
                <button
                  onClick={() => setShowEmails(false)}
                  className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-gray-300"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
                {emailsLoading ? (
                  <p className="text-[12px] text-gray-500 text-center py-8">Loading...</p>
                ) : emails.length === 0 ? (
                  <p className="text-[12px] text-gray-500 text-center py-8">Inbox empty</p>
                ) : (
                  emails.map(email => (
                    <div key={email.filename} className="border border-gray-800 rounded-lg p-3 bg-[#0d1117]">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="text-[13px] font-medium text-gray-200 truncate">{email.subject}</h4>
                        {email.date && <span className="text-[10px] text-gray-500 shrink-0">{email.date.slice(5)}</span>}
                      </div>
                      <p className="text-[11px] text-gray-500 mb-1">From: <span className="text-gray-400">{email.from}</span></p>
                      <p className="text-[11px] text-gray-400 line-clamp-2 leading-relaxed">{email.body.slice(0, 100)}</p>
                      <p className="text-[10px] text-gray-600 mt-1 font-mono">{email.filename}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
