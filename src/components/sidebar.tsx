'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Mail,
  Settings,
  ChevronLeft,
  ChevronRight,
  Building2,
} from 'lucide-react';

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

  const isActive = (path: string) => pathname === path;

  return (
    <aside
      className={`relative flex flex-col bg-white border-r border-gray-100 h-screen transition-all duration-300 ${
        collapsed ? 'w-[72px]' : 'w-[260px]'
      }`}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-16 border-b border-gray-50">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-indigo-600 text-white shrink-0">
          <Building2 size={18} />
        </div>
        {!collapsed && (
          <span className="text-base font-bold text-gray-900 whitespace-nowrap">
            Mind Agency
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        <Link
          href="/"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            isActive('/')
              ? 'bg-indigo-50 text-indigo-700'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          }`}
        >
          <LayoutDashboard size={18} />
          {!collapsed && '仪表盘'}
        </Link>

        {/* Agent 列表 */}
        <div className="pt-4">
          {!collapsed && (
            <p className="px-3 pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              团队成员
            </p>
          )}
          <div className="space-y-1">
            {agents.map(agent => (
              <Link
                key={agent.name}
                href={`/agents/${agent.name}`}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive(`/agents/${agent.name}`)
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-xs font-bold shrink-0">
                  {agent.name[0]}
                </div>
                {!collapsed && (
                  <div className="flex-1 flex items-center justify-between min-w-0">
                    <span className="truncate">{agent.name}</span>
                    {agent.emailCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-600 shrink-0">
                        {agent.emailCount}
                      </span>
                    )}
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      </nav>

      {/* 折叠按钮 */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-white border border-gray-200 flex items-center justify-center shadow-sm hover:shadow-md transition-shadow"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </aside>
  );
}
