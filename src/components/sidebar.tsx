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
      className={`relative flex flex-col bg-white border-r border-gray-200 h-screen transition-all duration-200 ${
        collapsed ? 'w-[56px]' : 'w-[210px]'
      }`}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-3.5 h-11 border-b border-gray-100">
        {!collapsed && (
          <span className="text-[13px] font-medium text-gray-900">
            Mind Agency
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
        <Link
          href="/"
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] transition-colors ${
            pathname === '/'
              ? 'bg-gray-100 text-gray-900 font-medium'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
          }`}
        >
          <span className="text-[11px] opacity-40">⌂</span>
          {!collapsed && 'Home'}
        </Link>

        {/* Agents */}
        <div className="pt-3">
          {!collapsed && (
            <p className="px-2.5 pb-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wide">
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
                    ? 'bg-gray-100 text-gray-900 font-medium'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                }`}
              >
                <span
                  className={`w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-medium shrink-0 ${
                    active
                      ? 'bg-gray-300 text-gray-700'
                      : 'bg-gray-150 text-gray-400'
                  }`}
                  style={{ backgroundColor: active ? '#d1d5db' : '#e5e7eb' }}
                >
                  {agent.name[0]}
                </span>
                {!collapsed && (
                  <span className="truncate">{agent.name}</span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Collapse */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-2.5 top-16 w-5 h-5 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors"
      >
        {collapsed ? <ChevronRight size={10} /> : <ChevronLeft size={10} />}
      </button>
    </aside>
  );
}
