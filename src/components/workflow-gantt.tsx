'use client';

import { useState, useMemo, useRef, useEffect } from 'react';

interface StepData {
  id: string;
  agent: string;
  action: string;
  status?: string;
  startedAt?: number;
  completedAt?: number;
  dependsOn?: string[];
  reviewer?: string;
  priority?: string;
  prompt?: string;
}

interface Props {
  steps: StepData[];
  progress: number;
  onStepClick?: (step: StepData) => void;
  onStepDelete?: (step: StepData) => void;
  onStepAdd?: (afterStep?: StepData) => void;
}

const COLORS: Record<string, { bg: string; border: string; text: string }> = {
  pending:     { bg: '#f3f4f6', border: '#d1d5db', text: '#6b7280' },
  in_progress: { bg: '#eff6ff', border: '#3b82f6', text: '#1d4ed8' },
  completed:   { bg: '#f0fdf4', border: '#22c55e', text: '#15803d' },
  failed:      { bg: '#fef2f2', border: '#ef4444', text: '#dc2626' },
  skipped:     { bg: '#f9fafb', border: '#e5e7eb', text: '#9ca3af' },
  blocked:     { bg: '#fffbeb', border: '#f59e0b', text: '#d97706' },
};

const ICONS: Record<string, string> = {
  pending: '○', in_progress: '◉', completed: '✓', failed: '✗', skipped: '–', blocked: '◐',
};

export default function WorkflowGantt({ steps, progress, onStepClick, onStepDelete, onStepAdd }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [tip, setTip] = useState({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; step: StepData } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => setContextMenu(null);
    if (contextMenu) document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [contextMenu]);

  // Group by agent
  const lanes = useMemo(() => {
    const m = new Map<string, StepData[]>();
    for (const s of steps) {
      const arr = m.get(s.agent) || [];
      arr.push(s);
      m.set(s.agent, arr);
    }
    return [...m.entries()];
  }, [steps]);

  // Topological layers
  const layers = useMemo(() => {
    const result: string[][] = [];
    const placed = new Set<string>();
    const map = new Map(steps.map(s => [s.id, s]));
    let rest = steps.map(s => s.id);
    while (rest.length > 0) {
      const layer: string[] = []; const next: string[] = [];
      for (const id of rest) {
        const deps = Array.isArray(map.get(id)?.dependsOn) ? map.get(id)!.dependsOn! : [];
        if (deps.every(d => placed.has(d)) || deps.length === 0) layer.push(id);
        else next.push(id);
      }
      if (layer.length === 0) break;
      for (const id of layer) placed.add(id);
      result.push(layer);
      rest = next;
    }
    return result;
  }, [steps]);

  // Assign layer index to each step
  const layerOf = useMemo(() => {
    const m = new Map<string, number>();
    layers.forEach((layer, i) => layer.forEach(id => m.set(id, i)));
    return m;
  }, [layers]);

  return (
    <div ref={containerRef} className="bg-surface rounded-xl w-full overflow-x-auto">
      {/* Header — layer labels */}
      <div className="flex border-b border-border bg-surface-alt h-7">
        {layers.map((layer, i) => (
          <div key={i} className="flex-1 flex items-center justify-center text-[9px] text-muted-foreground border-r border-border/50 last:border-r-0 px-1">
            {layer.length === 1 ? layer[0] : `Phase ${i + 1}`}
          </div>
        ))}
      </div>

      {/* Swimlanes */}
      {lanes.map(([agent, agentSteps], li) => (
        <div key={agent} className={`flex border-b border-border/30 ${li % 2 === 0 ? 'bg-surface/30' : ''}`}>
          {/* Agent label */}
          <div className="w-20 shrink-0 flex items-center px-2 text-[9px] font-semibold text-muted border-r border-border/50">
            {agent}
          </div>
          {/* Layer columns */}
          <div className="flex-1 flex">
            {layers.map((layer, li) => {
              const layerSteps = agentSteps.filter(s => layer.includes(s.id));
              return (
                <div key={li} className="flex-1 flex items-center justify-center gap-1.5 px-1 py-1.5 border-r border-border/30 last:border-r-0 min-h-[60px]">
                  {layerSteps.map(s => {
                    const status = s.status || 'pending';
                    const c = COLORS[status] || COLORS.pending;
                    const hov = hovered === s.id;
                    return (
                      <div key={s.id}
                        className={`rounded-lg px-2 py-1.5 flex flex-col justify-between cursor-pointer transition-all border ${hov ? 'shadow-md z-10' : 'shadow-sm'}`}
                        style={{ backgroundColor: c.bg, borderColor: c.border, minWidth: 100, flex: 1, maxWidth: 180 }}
                        onMouseEnter={e => { setHovered(s.id); setTip({ x: e.clientX, y: e.clientY }); }}
                        onMouseLeave={() => setHovered(null)}
                        onClick={() => onStepClick?.(s)}
                        onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, step: s }); }}>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-semibold text-foreground truncate max-w-[70%]">{s.id}</span>
                          <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                            style={{ backgroundColor: c.border, color: '#fff' }}>
                            {ICONS[status] || '○'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-[8px]" style={{ color: c.text }}>
                          {s.completedAt && s.startedAt && <span className="bg-white/50 px-1 rounded">{fmt(s.completedAt - s.startedAt)}</span>}
                          {s.reviewer && <span>· review</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Playhead */}
      <div className="absolute top-0 bottom-0 w-px bg-primary/60 z-30 pointer-events-none"
        style={{ left: `calc(20px + ${progress * 80}%)` }}>
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-primary" />
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-primary" />
      </div>

      {/* Tooltip */}
      {hovered && !contextMenu && (() => {
        const s = steps.find(x => x.id === hovered);
        if (!s) return null;
        const c = COLORS[s.status || 'pending'];
        return (
          <div className="fixed z-50 bg-canvas border border-border rounded-xl shadow-2xl p-3 w-64 pointer-events-none"
            style={{ left: Math.min(tip.x + 16, window.innerWidth - 280), top: tip.y - 8 }}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold" style={{ backgroundColor: c.border, color: '#fff' }}>{ICONS[s.status || 'pending']}</span>
              <span className="text-[12px] font-semibold text-foreground">{s.id}</span>
            </div>
            <div className="space-y-1 text-[10px] text-muted-foreground">
              <p>{s.agent} · {s.action}</p>
              {s.completedAt && s.startedAt && <p>耗时: {fmt(s.completedAt - s.startedAt)}</p>}
              {s.reviewer && <p>审查: {s.reviewer}</p>}
              {s.priority && <p>优先级: {s.priority}</p>}
            </div>
          </div>
        );
      })()}

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed z-50 bg-canvas border border-border rounded-xl shadow-2xl py-1 w-40"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}>
          <button onClick={() => { onStepClick?.(contextMenu.step); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-[12px] text-foreground hover:bg-surface">✎ 编辑</button>
          <button onClick={() => { onStepAdd?.(contextMenu.step); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-[12px] text-foreground hover:bg-surface">+ 添加步骤</button>
          {onStepDelete && (
            <button onClick={() => { onStepDelete(contextMenu.step); setContextMenu(null); }}
              className="w-full text-left px-3 py-1.5 text-[12px] text-destructive hover:bg-destructive-muted">× 删除</button>
          )}
        </div>
      )}
    </div>
  );
}

function fmt(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}
