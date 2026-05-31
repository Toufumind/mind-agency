'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/sidebar';
import Link from 'next/link';
import { Hash, Users, Mail } from 'lucide-react';

interface AgentInfo { name: string; emailCount: number; }
interface GroupInfo { name: string; }

export default function HomePage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [totalEmails, setTotalEmails] = useState(0);

  useEffect(() => {
    fetch('/api/agents').then(r => r.json()).then(d => {
      setAgents(d.agents || []);
      let t = 0; for (const a of d.agents || []) t += a.emailCount; setTotalEmails(t);
    }).catch(() => {});
    fetch('/api/groups/scan').then(r => r.json()).then(d => setGroups(d.groups?.map((g: string) => ({ name: g })) || [])).catch(() => {});
  }, []);

  return (
    <div className="flex h-screen bg-white">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-12">
          <h1 className="text-[22px] font-semibold text-gray-900 mb-1">Mind Agency</h1>
          <p className="text-[13px] text-gray-400 mb-10">Multi-agent collaboration platform</p>

          {/* Stats row */}
          <div className="flex gap-8 mb-10 text-[13px] text-gray-500">
            <span className="flex items-center gap-1.5"><Users size={13} />{agents.length} agents</span>
            <span className="flex items-center gap-1.5"><Hash size={13} />{groups.length} groups</span>
            <span className="flex items-center gap-1.5"><Mail size={13} />{totalEmails} emails</span>
          </div>

          {/* Quick links */}
          <div className="space-y-6">
            {groups.length > 0 && (
              <div>
                <h2 className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Groups</h2>
                <div className="flex flex-wrap gap-2">
                  {groups.map(g => (
                    <Link key={g.name} href={`/groups/${g.name}`}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-100 text-[13px] text-gray-700 hover:border-gray-200 hover:bg-gray-50 transition-all">
                      <Hash size={12} />{g.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h2 className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Agents</h2>
              <div className="flex flex-wrap gap-2">
                {agents.map(a => (
                  <Link key={a.name} href={`/agents/${a.name}`}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 text-[13px] text-gray-700 hover:border-gray-200 hover:bg-gray-50 transition-all">
                    <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-medium text-gray-500">{a.name[0]}</span>
                    {a.name}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
