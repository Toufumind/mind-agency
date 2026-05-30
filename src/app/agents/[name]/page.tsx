'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '@/components/sidebar';
import EmailList from '@/components/email-list';
import EmailViewer from '@/components/email-viewer';
import ComposeDialog from '@/components/compose-dialog';
import { ArrowLeft, Mail, FileText, Edit3, Plus, RefreshCw, Terminal } from 'lucide-react';
import type { Email } from '@/types';

export default function AgentPage() {
  const params = useParams();
  const agentName = params.name as string;

  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchEmails = useCallback(() => {
    setLoading(true);
    fetch(`/api/emails?agent=${agentName}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setEmails(data);
          // 如果当前选中的邮件被删了，清除选择
          if (selectedEmail && !data.find((e: Email) => e.filename === selectedEmail.filename)) {
            setSelectedEmail(null);
          }
        }
      })
      .catch(() => {})
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
      setSelectedEmail(null);
      fetchEmails();
    }
  };

  const handleRefresh = () => {
    fetchEmails();
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-100 px-8 py-4">
          <div className="flex items-center justify-between max-w-6xl mx-auto">
            <div className="flex items-center gap-4">
              <Link href="/" className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                <ArrowLeft size={18} />
              </Link>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-400 to-purple-500 text-white font-bold shadow-lg shadow-indigo-200/30">
                  {agentName[0]}
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{agentName}</h1>
                  <p className="text-xs text-gray-500">
                    <code className="text-[11px] font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                      Agents/{agentName}/email/
                    </code>
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={handleRefresh} className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 active:scale-[0.98]" title="刷新">
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                刷新
              </button>
              <button
                onClick={() => setShowCompose(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98] shadow-sm"
              >
                <Plus size={16} />
                写邮件
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden max-w-6xl mx-auto w-full">
          {/* 左侧：邮件列表 */}
          <div className="w-[380px] border-r border-gray-100 overflow-y-auto px-6 py-6 shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Mail size={15} className="text-gray-400" />
                收件箱
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-500">
                  {emails.length}
                </span>
              </h2>
            </div>
            <EmailList
              emails={emails}
              selectedEmail={selectedEmail}
              onSelect={setSelectedEmail}
              loading={loading}
            />

            {/* Agent 规则信息 */}
            <div className="mt-6 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow duration-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileText size={14} className="text-gray-400" />
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  规则
                </h3>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                此 Agent 的收件箱是 <code className="text-[11px] font-mono bg-gray-100 px-1 rounded">Agents/{agentName}/email/</code>。
                邮件以 .md 文件存储。
              </p>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50">
                <Edit3 size={12} className="text-gray-400" />
                <span className="text-[11px] text-gray-400">
                  CLAUDE.md 已加载
                </span>
              </div>
            </div>
          </div>

          {/* 右侧：邮件阅读 */}
          <div className="flex-1 overflow-y-auto px-8 py-6">
            {selectedEmail ? (
              <EmailViewer
                email={selectedEmail}
                onClose={() => setSelectedEmail(null)}
                onDelete={handleDelete}
                agentName={agentName}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="flex items-center justify-center w-20 h-20 rounded-3xl bg-gray-50 mb-5">
                  <Mail size={32} className="text-gray-300" />
                </div>
                <h3 className="text-base font-semibold text-gray-500 mb-1">
                  选择一封邮件阅读
                </h3>
                <p className="text-sm text-gray-400 max-w-xs">
                  点击左侧收件箱中的邮件查看详情，或写一封新邮件
                </p>
                <button
                  onClick={() => setShowCompose(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98] shadow-sm mt-5"
                >
                  <Plus size={16} />
                  写邮件
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 写邮件弹窗 */}
      <ComposeDialog
        open={showCompose}
        onClose={() => setShowCompose(false)}
        onSent={fetchEmails}
        currentAgent={agentName}
      />
    </div>
  );
}
