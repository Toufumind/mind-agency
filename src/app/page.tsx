'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/sidebar';
import AgentCard from '@/components/agent-card';

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

  const fetchData = () => {
    setLoading(true);
    fetch('/api/agents')
      .then(r => r.json())
      .then(data => {
        setAgents(data.agents || []);
        setStats(data.stats || { totalAgents: 0, totalEmails: 0 });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm border-b border-gray-200 px-6 py-3">
          <div className="flex items-center justify-between max-w-5xl mx-auto">
            <h1 className="text-sm font-medium text-gray-900">Home</h1>
            <span className="text-[12px] text-gray-400">
              {loading ? '...' : `${stats.totalAgents} agents · ${stats.totalEmails} emails`}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-5xl mx-auto px-6 py-6">
          {/* Stats row */}
          <div className="flex gap-4 mb-6 text-[13px] text-gray-500">
            <span>{stats.totalAgents} members</span>
            <span className="text-gray-200">·</span>
            <span>{stats.totalEmails} messages</span>
            <span className="text-gray-200">·</span>
            <span>{agents.filter(a => a.emailCount > 0).length} active</span>
          </div>

          {/* Agent grid */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white border border-gray-200 rounded-lg p-5 animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-gray-100 mb-3" />
                  <div className="h-3.5 bg-gray-100 rounded w-20 mb-1" />
                  <div className="h-3 bg-gray-50 rounded w-12" />
                </div>
              ))}
            </div>
          ) : agents.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
              <p className="text-sm text-gray-400">No team members yet</p>
              <p className="text-xs text-gray-300 mt-1">Add folders under Agents/ to create members</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {agents.map(agent => (
                <AgentCard key={agent.name} name={agent.name} emailCount={agent.emailCount} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
