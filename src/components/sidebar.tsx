'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users, Hash } from 'lucide-react';

interface AgentInfo { name: string; emailCount: number; }
interface GroupInfo { name: string; }

export default function Sidebar() {
  const pathname = usePathname();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);

  useEffect(() => {
    fetch('/api/agents').then(r => r.json()).then(d => setAgents(d.agents || [])).catch(() => {});
    fetch('/api/groups/scan').then(r => r.json())
      .then(d => { if (d.groups) setGroups(d.groups.map((g: string) => ({ name: g }))); })
      .catch(() => {});
  }, []);

  return (
    <aside className="w-[220px] bg-[#fbfbfa] border-r border-gray-100 flex flex-col shrink-0">
      <Link href="/" className="px-4 py-4 border-b border-gray-100">
        <span className="text-[14px] font-semibold text-gray-900 tracking-tight">Mind Agency</span>
      </Link>

      <nav className="flex-1 py-4 px-3 space-y-5 overflow-y-auto">
        {/* Team — Groups */}
        <section>
          <div className="flex items-center gap-1.5 px-2 pb-2">
            <Hash size={12} className="text-gray-400" />
            <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Team</span>
          </div>
          <div className="space-y-0.5">
            {groups.map(g => {
              const active = pathname === `/groups/${g.name}`;
              return (
                <Link key={g.name} href={`/groups/${g.name}`}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors ${
                    active ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                  }`}>
                  <span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-500 shrink-0">#</span>
                  <span className="truncate">{g.name}</span>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Members — Agents */}
        <section>
          <div className="flex items-center gap-1.5 px-2 pb-2">
            <Users size={12} className="text-gray-400" />
            <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Members</span>
            <span className="text-[10px] text-gray-300 ml-auto">{agents.length}</span>
          </div>
          <div className="space-y-0.5">
            {agents.map(a => {
              const active = pathname === `/agents/${a.name}`;
              return (
                <Link key={a.name} href={`/agents/${a.name}`}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors ${
                    active ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                  }`}>
                  <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-medium text-gray-500 shrink-0">{a.name[0]}</span>
                  <span className="truncate">{a.name}</span>
                  {a.emailCount > 0 && <span className="text-[10px] text-gray-300 ml-auto">{a.emailCount}</span>}
                </Link>
              );
            })}
          </div>
        </section>
      </nav>
    </aside>
  );
}
