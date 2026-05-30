'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '@/components/sidebar';
import EmailList from '@/components/email-list';
import EmailViewer from '@/components/email-viewer';
import ComposeDialog from '@/components/compose-dialog';
import { useToast } from '@/components/toast';
import { ArrowLeft, Plus, Terminal } from 'lucide-react';
import type { Email } from '@/types';

export default function AgentPage() {
  const params = useParams();
  const agentName = params.name as string;

  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const { toast } = useToast();

  const fetchEmails = useCallback(() => {
    setLoading(true);
    fetch(`/api/emails?agent=${agentName}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setEmails(data);
          if (selectedEmail && !data.find((e: Email) => e.filename === selectedEmail.filename)) {
            setSelectedEmail(null);
          }
        }
      })
      .catch(() => toast('Failed to load emails', 'error'))
      .finally(() => setLoading(false));
  }, [agentName, selectedEmail]);

  useEffect(() => {
    fetchEmails();
  }, [agentName]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (email: Email) => {
    const res = await fetch(`/api/emails?agent=${agentName}&file=${email.filename}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (data.success) {
      toast('Deleted');
      setSelectedEmail(null);
      fetchEmails();
    } else {
      toast(data.error || 'Delete failed', 'error');
    }
  };

  const handleLaunch = async () => {
    setLaunching(true);
    try {
      const res = await fetch(`/api/agents/${agentName}/launch`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast('Terminal launched');
      } else {
        toast(data.error || 'Launch failed', 'error');
      }
    } catch {
      toast('Launch failed', 'error');
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm border-b border-gray-200 px-5 py-2.5">
          <div className="flex items-center justify-between max-w-5xl mx-auto">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <ArrowLeft size={15} />
              </Link>
              <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[11px] font-medium text-gray-500">
                {agentName[0]}
              </span>
              <div>
                <h1 className="text-sm font-medium text-gray-900">{agentName}</h1>
                <p className="text-[11px] text-gray-400 font-mono">Agents/{agentName}/email/</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={handleLaunch}
                disabled={launching}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                <Terminal size={13} />
                Terminal
              </button>
              <button
                onClick={() => setShowCompose(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-900 text-white text-[12px] font-medium hover:bg-gray-800 transition-colors"
              >
                <Plus size={13} />
                Compose
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden max-w-5xl mx-auto w-full">
          {/* Left: email list */}
          <div className="w-[340px] border-r border-gray-100 overflow-y-auto px-4 py-4 shrink-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[13px] font-medium text-gray-900">
                Inbox
                {!loading && (
                  <span className="ml-1.5 text-[11px] text-gray-400">{emails.length}</span>
                )}
              </h2>
            </div>
            <EmailList
              emails={emails}
              selectedEmail={selectedEmail}
              onSelect={setSelectedEmail}
              loading={loading}
            />
          </div>

          {/* Right: email viewer */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {selectedEmail ? (
              <EmailViewer
                email={selectedEmail}
                onClose={() => setSelectedEmail(null)}
                onDelete={handleDelete}
                agentName={agentName}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <p className="text-sm text-gray-400">Select an email to read</p>
                <p className="text-xs text-gray-300 mt-1">
                  Click a message from the inbox, or compose a new one
                </p>
                <div className="flex items-center gap-2 mt-4">
                  <button
                    onClick={() => setShowCompose(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-900 text-white text-[12px] font-medium hover:bg-gray-800 transition-colors"
                  >
                    <Plus size={13} />
                    Compose
                  </button>
                  <button
                    onClick={handleLaunch}
                    disabled={launching}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                  >
                    <Terminal size={13} />
                    Terminal
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <ComposeDialog
        open={showCompose}
        onClose={() => setShowCompose(false)}
        onSent={() => { fetchEmails(); toast('Sent'); }}
        currentAgent={agentName}
      />
    </div>
  );
}
