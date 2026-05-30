'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/sidebar';
import AgentCard from '@/components/agent-card';
import { Users, Mail, Building2, TrendingUp } from 'lucide-react';

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
    <div className="flex h-screen overflow-hidden">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-100 px-8 py-4">
          <div className="flex items-center justify-between max-w-6xl mx-auto">
            <div>
              <h1 className="text-xl font-bold text-gray-900">仪表盘</h1>
              <p className="text-sm text-gray-500 mt-0.5">Agent 公司总览</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-600 border border-emerald-100">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                运行中
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-6xl mx-auto px-8 py-8">
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow duration-200 p-5 flex items-center gap-4">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-indigo-50">
                <Building2 size={20} className="text-indigo-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '...' : stats.totalAgents}
                </p>
                <p className="text-xs text-gray-500">团队成员</p>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow duration-200 p-5 flex items-center gap-4">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-emerald-50">
                <Mail size={20} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '...' : stats.totalEmails}
                </p>
                <p className="text-xs text-gray-500">总邮件数</p>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow duration-200 p-5 flex items-center gap-4">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-orange-50">
                <TrendingUp size={20} className="text-orange-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '...' : agents.filter(a => a.emailCount > 0).length}
                </p>
                <p className="text-xs text-gray-500">活跃成员</p>
              </div>
            </div>
          </div>

          {/* Agent Grid */}
          <div className="mb-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">团队成员</h2>
            <p className="text-sm text-gray-500">点击查看详情和收件箱</p>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow duration-200 p-6 animate-pulse">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-gray-100" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-100 rounded w-20" />
                      <div className="h-3 bg-gray-50 rounded w-16" />
                    </div>
                  </div>
                  <div className="h-3 bg-gray-50 rounded w-24" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.map(agent => (
                <AgentCard
                  key={agent.name}
                  name={agent.name}
                  emailCount={agent.emailCount}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
