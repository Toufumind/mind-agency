'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Agent {
  name: string;
  emailCount: number;
}

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.json())
      .then(data => setAgents(data.agents || []))
      .catch(() => {});
  }, []);

  return (
    <aside
      className={`relative flex flex-col bg-[#161b22] border-r border-gray-800 h-screen transition-all duration-200 ${
        collapsed ? 'w-[56px]' : 'w-[210px]'
      }`}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-3.5 h-11 border-b border-gray-800">
        {!collapsed && (
          <span className="text-[13px] font-medium text-gray-200">
            Mind Agency
          </span>
        )}
      </div>

      <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
        <Link
          href="/"
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] transition-colors ${
            pathname === '/'
              ? 'bg-gray-800 text-gray-200 font-medium'
              : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-300'
          }`}
        >
          <span className="text-[11px] opacity-40">⌂</span>
          {!collapsed && 'Home'}
        </Link>

        <div className="pt-3">
          {!collapsed && (
            <p className="px-2.5 pb-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide">
              Team
            </p>
          )}
          {agents.map(agent => {
            const active = pathname === `/agents/${agent.name}`;
            return (
              <Link
                key={agent.name}
                href={`/agents/${agent.name}`}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] transition-colors ${
                  active
                    ? 'bg-gray-800 text-gray-200 font-medium'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-300'
                }`}
              >
                <span className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-medium shrink-0 bg-gray-700 text-gray-400">
                  {agent.name[0]}
                </span>
                {!collapsed && <span className="truncate">{agent.name}</span>}
              </Link>
            );
          })}
        </div>
      </nav>

      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-2.5 top-16 w-5 h-5 rounded-full bg-[#21262d] border border-gray-700 flex items-center justify-center hover:bg-gray-700 transition-colors text-gray-500"
      >
        {collapsed ? <ChevronRight size={10} /> : <ChevronLeft size={10} />}
      </button>
    </aside>
  );
}
