'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users } from 'lucide-react';

interface AgentInfo { name: string; emailCount: number; }

export default function Sidebar() {
  const pathname = usePathname();
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  useEffect(() => {
    fetch('/api/agents').then(r => r.json()).then(d => setAgents(d.agents || [])).catch(() => {});
  }, []);

  return (
    <aside className="w-[200px] bg-[#fbfbfa] border-r border-gray-100 flex flex-col shrink-0">
      <Link href="/" className="px-4 py-3.5 border-b border-gray-100 text-[13px] font-medium text-gray-800 hover:text-gray-600 transition-colors">
        Mind Agency
      </Link>
      <nav className="flex-1 py-3 px-3 space-y-0.5 overflow-y-auto">
        <div className="flex items-center gap-1.5 px-2.5 pb-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wide">
          <Users size={11} /> Team
        </div>
        {agents.map(a => {
          const active = pathname === `/agents/${a.name}`;
          return (
            <Link key={a.name} href={`/agents/${a.name}`}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] transition-colors ${
                active ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
              }`}>
              <span className="w-5 h-5 rounded-md bg-gray-100 flex items-center justify-center text-[10px] text-gray-400 shrink-0">{a.name[0]}</span>
              <span className="truncate">{a.name}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
