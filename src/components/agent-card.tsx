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
      className="block bg-canvas border border-border rounded-lg p-5 hover:border-border-strong transition-colors group"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="w-8 h-8 rounded-full bg-surface-alt flex items-center justify-center text-xs font-medium text-muted">
          {name[0]}
        </span>
        {emailCount > 0 && (
          <span className="text-[11px] text-muted-foreground">{emailCount}</span>
        )}
      </div>
      <h3 className="text-sm font-medium text-foreground">{name}</h3>
      <p className="text-xs text-muted-foreground mt-1">Agent</p>
    </Link>
  );
}
