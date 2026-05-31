'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Agent {
  name: string;
  emailCount: number;
}

export default function Sidebar() {
  const pathname = usePathname();
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.json())
      .then(d => setAgents(d.agents || []))
      .catch(() => {});
  }, []);

  return (
    <aside className="w-[200px] bg-[#161b22] border-r border-[#21262d] flex flex-col shrink-0">
      <Link href="/" className="px-4 py-3.5 border-b border-[#21262d] text-[13px] font-medium text-[#e6edf3] hover:text-white transition-colors">
        Mind Agency
      </Link>

      <nav className="flex-1 py-3 px-3 space-y-0.5 overflow-y-auto">
        {agents.map(a => {
          const active = pathname === `/agents/${a.name}`;
          return (
            <Link
              key={a.name}
              href={`/agents/${a.name}`}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] transition-colors ${
                active ? 'bg-[#21262d] text-[#e6edf3]' : 'text-[#8b949e] hover:bg-[#1c2128] hover:text-[#c9d1d9]'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-[#21262d] flex items-center justify-center text-[10px] text-[#8b949e] shrink-0">
                {a.name[0]}
              </span>
              <span className="truncate">{a.name}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
