'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import ChatPanel from '@/components/chat-panel';
import Sidebar from '@/components/sidebar';
import { Mail, FileText, Hash, Users } from 'lucide-react';

interface Context { agent: string; emails: number; messages: number; groups: string[]; rulesPreview: string; }

export default function AgentPage() {
  const { name } = useParams<{ name: string }>();
  const [ctx, setCtx] = useState<Context | null>(null);
  const [showCtx, setShowCtx] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/agents'),
      fetch(`/api/agents/${name}/chat`),
      fetch(`/api/groups/scan?agent=${name}`),
      fetch(`/api/emails?agent=${name}`),
    ]).then(async ([agentsR, chatR, groupsR, emailsR]) => {
      const agents = await agentsR.json();
      const chat = await chatR.json();
      const groups = await groupsR.json();
      const emails = await emailsR.json();
      const agent = (agents.agents || []).find((a: any) => a.name === name);
      // Fetch CLAUDE.md preview from agent
      const rulesPreview = 'CLAUDE.md rules loaded from Agents/' + name + '/';
      setCtx({
        agent: name,
        emails: Array.isArray(emails) ? emails.length : 0,
        messages: chat.messages?.length || 0,
        groups: groups.groups || [],
        rulesPreview,
      });
    }).catch(() => {});
  }, [name]);

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        {/* Context bar */}
        {ctx && showCtx && (
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center gap-4 shrink-0 text-[12px]">
            <span className="font-medium text-gray-800">{ctx.agent}</span>
            <span className="text-gray-300">·</span>
            <span className="flex items-center gap-1 text-gray-500">
              <Mail size={11} />{ctx.emails} emails
            </span>
            <span className="flex items-center gap-1 text-gray-500">
              <FileText size={11} />{ctx.messages} messages
            </span>
            {ctx.groups.length > 0 && (
              <>
                <span className="text-gray-300">·</span>
                <span className="flex items-center gap-1 text-gray-500">
                  <Hash size={11} />{ctx.groups.join(', ')}
                </span>
              </>
            )}
            <button onClick={() => setShowCtx(false)} className="text-gray-300 hover:text-gray-500 ml-auto">×</button>
          </div>
        )}

        {/* Chat */}
        <div className="flex-1 min-h-0">
          <ChatPanel agentName={name} />
        </div>
      </main>
    </div>
  );
}
