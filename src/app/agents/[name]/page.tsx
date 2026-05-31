'use client';

import { useParams } from 'next/navigation';
import ChatPanel from '@/components/chat-panel';
import Sidebar from '@/components/sidebar';

export default function AgentPage() {
  const { name } = useParams<{ name: string }>();

  return (
    <div className="flex h-screen overflow-hidden bg-[#0d1117]">
      <Sidebar />
      <main className="flex-1 min-w-0">
        <ChatPanel agentName={name} />
      </main>
    </div>
  );
}
