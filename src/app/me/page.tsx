'use client';

import Sidebar from '@/components/sidebar';
import EmailClient from '@/components/email-client';
import { User } from 'lucide-react';

export default function MePage() {
  return (
    <div className="flex h-full bg-canvas">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3 shrink-0 bg-canvas">
          <span className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center"><User size={14} className="text-canvas" /></span>
          <h1 className="text-[14px] font-semibold text-foreground">Me</h1>
        </div>
        <EmailClient agentName="me" />
      </main>
    </div>
  );
}
