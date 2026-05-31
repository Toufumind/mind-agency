'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/sidebar';
import Link from 'next/link';

interface Agent {
  name: string;
  emailCount: number;
}

export default function HomePage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.json())
      .then(d => { setAgents(d.agents || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-screen bg-[#0d1117]">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-10">
          <h1 className="text-[20px] font-medium text-[#e6edf3] mb-1">Mind Agency</h1>
          <p className="text-[13px] text-[#8b949e] mb-8">Agent team collaboration</p>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-[#161b22] border border-[#21262d] rounded-lg p-4 animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-[#21262d] mb-2" />
                  <div className="h-3 bg-[#21262d] rounded w-16" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {agents.map(a => (
                <Link
                  key={a.name}
                  href={`/agents/${a.name}`}
                  className="bg-[#161b22] border border-[#21262d] rounded-lg p-4 hover:border-[#30363d] transition-colors"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <span className="w-8 h-8 rounded-full bg-[#21262d] flex items-center justify-center text-xs text-[#8b949e]">
                      {a.name[0]}
                    </span>
                    <span className="text-[14px] font-medium text-[#e6edf3]">{a.name}</span>
                  </div>
                  <span className="text-[12px] text-[#8b949e]">{a.emailCount} emails</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
