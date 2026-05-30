'use client';

import Link from 'next/link';

interface AgentCardProps {
  name: string;
  emailCount: number;
}

export default function AgentCard({ name, emailCount }: AgentCardProps) {
  return (
    <Link
      href={`/agents/${name}`}
      className="block bg-white border border-gray-200 rounded-lg p-5 hover:border-gray-300 transition-colors group"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-500">
          {name[0]}
        </span>
        {emailCount > 0 && (
          <span className="text-[11px] text-gray-400">{emailCount}</span>
        )}
      </div>
      <h3 className="text-sm font-medium text-gray-900">{name}</h3>
      <p className="text-xs text-gray-400 mt-1">Agent</p>
    </Link>
  );
}
