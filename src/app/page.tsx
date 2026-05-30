'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/sidebar';
import Link from 'next/link';

interface Agent {
  name: string;
  emailCount: number;
}

interface Stats {
  totalAgents: number;
  totalEmails: number;
}

export default function HomePage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [stats, setStats] = useState<Stats>({ totalAgents: 0, totalEmails: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.json())
      .then(data => {
        setAgents(data.agents || []);
        setStats(data.stats || { totalAgents: 0, totalEmails: 0 });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-[#0d1117]">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-[#0d1117]/90 backdrop-blur-sm border-b border-gray-800 px-6 py-3">
          <div className="flex items-center justify-between max-w-5xl mx-auto">
            <h1 className="text-sm font-medium text-gray-200">Home</h1>
            <span className="text-[12px] text-gray-500">
              {loading ? '...' : `${stats.totalAgents} agents · ${stats.totalEmails} emails`}
            </span>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-6">
          <div className="flex gap-4 mb-6 text-[13px] text-gray-500">
            <span>{stats.totalAgents} members</span>
            <span className="text-gray-700">·</span>
            <span>{stats.totalEmails} messages</span>
            <span className="text-gray-700">·</span>
            <span>{agents.filter(a => a.emailCount > 0).length} active</span>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-[#161b22] border border-gray-800 rounded-lg p-5 animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-gray-800 mb-3" />
                  <div className="h-3.5 bg-gray-800 rounded w-20 mb-1" />
                  <div className="h-3 bg-gray-800 rounded w-12" />
                </div>
              ))}
            </div>
          ) : agents.length === 0 ? (
            <div className="bg-[#161b22] border border-gray-800 rounded-lg p-12 text-center">
              <p className="text-sm text-gray-500">No team members yet</p>
              <p className="text-xs text-gray-600 mt-1">Add folders under Agents/ to create members</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {agents.map(agent => (
                <Link
                  key={agent.name}
                  href={`/agents/${agent.name}`}
                  className="block bg-[#161b22] border border-gray-800 rounded-lg p-5 hover:border-gray-600 transition-colors group"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-xs font-medium text-gray-400">
                      {agent.name[0]}
                    </span>
                    {agent.emailCount > 0 && (
                      <span className="text-[11px] text-gray-500">{agent.emailCount}</span>
                    )}
                  </div>
                  <h3 className="text-sm font-medium text-gray-200">{agent.name}</h3>
                  <p className="text-xs text-gray-500 mt-1">Agent</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
