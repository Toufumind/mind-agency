'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/sidebar';
import AgentCard from '@/components/agent-card';
import { useToast } from '@/components/toast';
import { Users, Mail, Building2, TrendingUp, Loader2 } from 'lucide-react';

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
  const { toast } = useToast();

  const fetchData = () => {
    setLoading(true);
    fetch('/api/agents')
      .then(r => r.json())
      .then(data => {
        setAgents(data.agents || []);
        setStats(data.stats || { totalAgents: 0, totalEmails: 0 });
      })
      .catch(() => toast('加载失败，请检查服务', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-100 px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between max-w-6xl mx-auto">
            <div>
              <h1 className="text-xl font-bold text-gray-900">仪表盘</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Agent 公司总览
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-emerald-50 text-emerald-600 border border-emerald-100">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
                系统运行中
              </div>
              <button
                onClick={fetchData}
                className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 cursor-pointer bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 active:scale-[0.98]"
              >
                <Loader2 size={15} className={loading ? 'animate-spin' : 'hidden'} />
                刷新
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-8">
          {/* Welcome */}
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 lg:p-8 mb-8 text-white shadow-lg shadow-indigo-500/20">
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm">
                <Building2 size={24} className="text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold">欢迎来到 Mind Agency</h2>
                <p className="text-sm text-white/70">Agent 团队协作与邮件通信平台</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium bg-white/15 text-white/90 backdrop-blur-sm">
                本地文件系统存储
              </span>
              <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium bg-white/15 text-white/90 backdrop-blur-sm">
                Markdown 邮件格式
              </span>
              <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium bg-white/15 text-white/90 backdrop-blur-sm">
                Git 版本控制
              </span>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <StatCard
              icon={<Building2 size={20} className="text-indigo-600" />}
              value={loading ? '...' : stats.totalAgents}
              label="团队成员"
              bgClass="bg-indigo-50"
            />
            <StatCard
              icon={<Mail size={20} className="text-emerald-600" />}
              value={loading ? '...' : stats.totalEmails}
              label="总邮件数"
              bgClass="bg-emerald-50"
            />
            <StatCard
              icon={<TrendingUp size={20} className="text-orange-500" />}
              value={loading ? '...' : agents.filter(a => a.emailCount > 0).length}
              label="活跃成员"
              bgClass="bg-orange-50"
            />
          </div>

          {/* Agent Grid */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900">团队成员</h2>
                <p className="text-sm text-gray-500">点击查看详情和收件箱</p>
              </div>
              {!loading && agents.length === 0 && (
                <span className="text-xs text-gray-400">暂无成员</span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div
                  key={i}
                  className="bg-white rounded-2xl border border-gray-100 p-6 animate-pulse"
                >
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
          ) : agents.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
              <div className="flex justify-center mb-4">
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-50">
                  <Users size={28} className="text-gray-300" />
                </div>
              </div>
              <h3 className="text-base font-semibold text-gray-500 mb-1">
                还没有团队成员
              </h3>
              <p className="text-sm text-gray-400 max-w-sm mx-auto">
                在 Agents/ 目录下创建新文件夹即可添加团队成员。每个文件夹代表一个 Agent。
              </p>
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

function StatCard({
  icon,
  value,
  label,
  bgClass,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  bgClass: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow duration-200 p-5 flex items-center gap-4">
      <div className={`flex items-center justify-center w-11 h-11 rounded-xl ${bgClass}`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  );
}
