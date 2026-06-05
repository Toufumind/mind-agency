'use client';

import { useState, useMemo } from 'react';

interface StepData {
  id: string;
  agent: string;
  action: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'blocked';
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

const LANE_H = 72;
const LANE_GAP = 2;
const CARD_H = 44;
const CARD_PAD = 12;

export default function WorkflowGantt({ steps, progress, onStepClick, onStepDelete, onStepAdd }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [tip, setTip] = useState({ x: 0, y: 0 });

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

  // Position: layer index → x position
  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; w: number }>();
    if (layers.length === 0) return pos;
    const lw = 100 / layers.length;
    for (let i = 0; i < layers.length; i++) {
      for (const id of layers[i]) {
        pos.set(id, { x: i * lw + 1, w: lw - 2 });
      }
    }
    return pos;
  }, [layers]);

  const totalH = lanes.length * (LANE_H + LANE_GAP) + LANE_GAP;
  const playheadX = Math.min(Math.max(progress * 100, 0), 99);

  // Edges: from right side of source to left side of target
  const edges = useMemo(() => {
    const res: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const agentY = new Map(lanes.map(([a], i) => [a, i * (LANE_H + LANE_GAP) + LANE_H / 2]));
    const stepMap = new Map(steps.map(s => [s.id, s]));
    for (const s of steps) {
      const p = positions.get(s.id);
      if (!p) continue;
      for (const depId of (Array.isArray(s.dependsOn) ? s.dependsOn : [])) {
        const dp = positions.get(depId);
        const dep = stepMap.get(depId);
        if (!dp || !dep) continue;
        res.push({ x1: dp.x + dp.w, y1: agentY.get(dep.agent) || 0, x2: p.x, y2: agentY.get(s.agent) || 0 });
      }
    }
    return res;
  }, [steps, lanes, positions]);

  return (
    <div className="bg-surface rounded-xl w-full" style={{ minHeight: totalH + 32 }}>
      {/* Header bar */}
      <div className="h-8 bg-surface-alt border-b border-border flex items-center px-2 text-[9px] text-muted-foreground relative">
        {layers.map((layer, i) => {
          const left = (i / Math.max(layers.length, 1)) * 100;
          const w = (1 / Math.max(layers.length, 1)) * 100;
          return (
            <span key={i} className="absolute text-center truncate px-1" style={{ left: `${left}%`, width: `${w}%` }}>
              {layer.length === 1 ? layer[0] : `Phase ${i + 1}`}
            </span>
          );
        })}
      </div>

      <div className="relative" style={{ height: totalH }}>
        {/* Dependency arrows */}
        <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
          <defs>
            <marker id="ah" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto">
              <polygon points="0 0, 7 2.5, 0 5" fill="#9ca3af" />
            </marker>
          </defs>
          {edges.map((e, i) => {
            const w = 1000;
            const x1 = (e.x1 / 100) * w;
            const x2 = (e.x2 / 100) * w;
            const mx = (x1 + x2) / 2;
            return (
              <path key={i}
                d={`M${x1},${e.y1} C${mx},${e.y1} ${mx},${e.y2} ${x2},${e.y2}`}
                stroke="#d1d5db" strokeWidth="1.5" fill="none" strokeDasharray="4 3"
                markerEnd="url(#ah)" />
            );
          })}
        </svg>

        {/* Lanes */}
        {lanes.map(([agent, agentSteps], li) => (
          <div key={agent} className="absolute"
            style={{ left: 0, right: 0, top: li * (LANE_H + LANE_GAP) + LANE_GAP, height: LANE_H, width: '100%' }}>
            <div className={`absolute inset-0 rounded ${li % 2 === 0 ? 'bg-surface/40' : ''}`} />
            <div className="absolute left-1.5 top-0.5 text-[9px] font-semibold text-muted z-10 select-none">{agent}</div>

            {agentSteps.map(s => {
              const p = positions.get(s.id);
              if (!p) return null;
              const c = COLORS[s.status || 'pending'] || COLORS.pending;
              const hov = hovered === s.id;
              return (
                <div key={s.id}
                  className={`absolute transition-all cursor-pointer ${hov ? 'z-20' : 'z-10'}`}
                  style={{ left: `${p.x}%`, top: (LANE_H - CARD_H) / 2, width: `${p.w}%`, height: CARD_H }}
                  onMouseEnter={e => { setHovered(s.id); setTip({ x: e.clientX, y: e.clientY }); }}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onStepClick?.(s)}>
                  <div className={`h-full rounded-lg flex items-center gap-2 px-2.5 transition-shadow border ${hov ? 'shadow-md' : 'shadow-sm'}`}
                    style={{ backgroundColor: c.bg, borderColor: c.border }}>
                    {/* Status dot */}
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                      style={{ backgroundColor: c.border, color: '#fff' }}>
                      {ICONS[s.status || 'pending']}
                    </span>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-semibold text-foreground truncate">{s.id}</div>
                      <div className="flex items-center gap-1 text-[8px]" style={{ color: c.text }}>
                        {s.completedAt && s.startedAt && <span>{fmt(s.completedAt - s.startedAt)}</span>}
                        {s.reviewer && <span>· review</span>}
                      </div>
                    </div>
                    {/* Hover actions */}
                    {hov && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button onClick={e => { e.stopPropagation(); onStepClick?.(s); }}
                          className="w-5 h-5 rounded flex items-center justify-center bg-canvas/80 hover:bg-canvas text-muted-foreground text-[9px]" title="编辑">✎</button>
                        <button onClick={e => { e.stopPropagation(); onStepAdd?.(s); }}
                          className="w-5 h-5 rounded flex items-center justify-center bg-canvas/80 hover:bg-canvas text-muted-foreground text-[9px]" title="添加">+</button>
                        {onStepDelete && (
                          <button onClick={e => { e.stopPropagation(); onStepDelete(s); }}
                            className="w-5 h-5 rounded flex items-center justify-center bg-canvas/80 hover:bg-red-50 text-muted-foreground hover:text-red-500 text-[9px]" title="删除">×</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {/* Playhead */}
        <div className="absolute top-0 bottom-0 w-px bg-primary/60 z-30 pointer-events-none"
          style={{ left: `${playheadX}%` }}>
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-primary" />
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-primary" />
        </div>
      </div>

      {/* Tooltip */}
      {hovered && (() => {
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
    </div>
  );
}

function fmt(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}
