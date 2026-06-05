'use client';

import { useState, useEffect } from 'react';
import { useSidebarData } from './sidebar-context';

/**
 * Agent Status Bar — thin horizontal strip at the top of the app.
 * Shows each agent's current status with a colored dot.
 */
export default function AgentStatusBar() {
  const { agents, activity } = useSidebarData();

  // Don't render on /setup
  if (typeof window !== 'undefined' && window.location.pathname === '/setup') {
    return null;
  }

  if (agents.length === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-7 bg-surface border-b border-border flex items-center px-4 gap-3 overflow-x-auto shrink-0">
      {agents.filter(a => a.name !== 'me').map(a => {
        const act = activity[a.name];
        const isActive = act?.active;
        return (
          <div key={a.name} className="flex items-center gap-1.5 shrink-0">
            <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-success shadow-[0_0_4px_var(--color-success)]' : 'bg-border'}`} />
            <span className="text-[11px] text-muted-foreground truncate max-w-[60px]">{a.name}</span>
          </div>
        );
      })}
    </div>
  );
}
