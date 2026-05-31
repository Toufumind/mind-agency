'use client';

import { useParams } from 'next/navigation';
import ChatPanel from '@/components/chat-panel';

export default function AgentPage() {
  const { name } = useParams<{ name: string }>();
  return (
    <div className="h-screen overflow-hidden">
      <ChatPanel agentName={name} />
    </div>
  );
}
