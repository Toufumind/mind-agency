'use client';

import { useState, useEffect } from 'react';
import { useSidebarData } from './sidebar-context';
import { Minus, Square, X, Maximize2 } from 'lucide-react';

/**
 * Custom title bar for the Electron window.
 * Replaces the native Windows title bar.
 * Includes agent status dots + window controls.
 */
export default function TitleBar() {
  const { agents, activity } = useSidebarData();
  const [maximized, setMaximized] = useState(false);
  const isElectron = typeof window !== 'undefined' && window.navigator.userAgent.includes('Electron');

  useEffect(() => {
    if (!isElectron) return;
    // Listen for maximize/restore events
    const check = () => {
      try {
        setMaximized((window as any).mind?.isMaximized?.() || false);
      } catch {}
    };
    const interval = setInterval(check, 1000);
    // Also check on resize
    window.addEventListener('resize', check);
    return () => { clearInterval(interval); window.removeEventListener('resize', check); };
  }, [isElectron]);

  const winAction = (action: string) => {
    try { (window as any).mind?.[action]?.(); } catch {}
  };

  const nonAgent = agents.filter(a => a.name !== 'me');
  // Don't render on /setup or when there's no data
  const isSetup = typeof window !== 'undefined' && window.location.pathname === '/setup';
  if (isSetup && !isElectron) return null;
  // On non-Electron, still show a simplified bar
  if (!isElectron && nonAgent.length === 0) return null;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-50 h-9 bg-surface border-b border-border flex items-center shrink-0 select-none ${isElectron ? 'drag-region' : ''}`}
    >
      {/* App name */}
      <div className="flex items-center gap-2 px-4 min-w-0">
        <span className="text-[12px] font-medium text-foreground tracking-tight">Mind Agency</span>
      </div>

      {/* Agent activity summary — only show who's busy */}
      {nonAgent.length > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground no-drag overflow-hidden flex-1 min-w-0">
          {(() => {
            const busy = nonAgent.filter(a => ['processing','chatting','working'].includes(activity[a.name]?.status || ''));
            if (busy.length > 0) {
              return <span className="truncate">{busy.map(a => a.name).join('、')} 处理中</span>;
            }
            return null;
          })()}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Window controls (Electron only) */}
      {isElectron && (
        <div className="flex items-center h-full no-drag">
          <button onClick={() => winAction('minimize')}
            className="w-11 h-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-border/50 transition-colors">
            <Minus size={13} />
          </button>
          <button onClick={() => winAction('maximize')}
            className="w-11 h-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-border/50 transition-colors">
            {maximized ? <Maximize2 size={11} /> : <Square size={11} />}
          </button>
          <button onClick={() => winAction('close')}
            className="w-11 h-full flex items-center justify-center text-muted-foreground hover:text-canvas hover:bg-destructive transition-colors">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
