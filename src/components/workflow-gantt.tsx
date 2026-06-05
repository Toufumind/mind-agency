'use client';

import { useState, useMemo } from 'react';

interface StepData {
  id: string;
  agent: string;
  action: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'blocked';
  startedAt?: number;
  completedAt?: number;
  output?: string;
  dependsOn?: string[];
  reviewer?: string;
  priority?: string;
  prompt?: string;
}

interface Props {
  steps: StepData[];
  /** 0-1 progress through the workflow (0 = start, 1 = done) */
  progress: number;
  onStepClick?: (step: StepData) => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#a0aab8',
  in_progress: '#3b82f6',
  completed: '#10b981',
  failed: '#ef4444',
  skipped: '#d1d5db',
  blocked: '#f59e0b',
};

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  in_progress: '◉',
  completed: '✓',
  failed: '✗',
  skipped: '–',
  blocked: '◐',
};

export default function WorkflowGantt({ steps, progress, onStepClick }: Props) {
  const [hoveredStep, setHoveredStep] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Group steps by agent
  const agents = useMemo(() => {
    const agentMap = new Map<string, StepData[]>();
    for (const s of steps) {
      const lane = agentMap.get(s.agent) || [];
      lane.push(s);
      agentMap.set(s.agent, lane);
    }
    return [...agentMap.entries()];
  }, [steps]);

  // Topological sort into layers (parallel groups)
  const layers = useMemo(() => {
    const result: string[][] = [];
    const placed = new Set<string>();
    const stepMap = new Map(steps.map(s => [s.id, s]));
    let remaining = steps.map(s => s.id);

    while (remaining.length > 0) {
      const layer: string[] = [];
      const next: string[] = [];
      for (const id of remaining) {
        const s = stepMap.get(id)!;
        const deps = Array.isArray(s.dependsOn) ? s.dependsOn : [];
        // Only check deps from PREVIOUS layers (not current)
        if (deps.every(d => placed.has(d)) || deps.length === 0) {
          layer.push(id);
        } else {
          next.push(id);
        }
      }
      if (layer.length === 0) break;
      // Mark all steps in this layer as placed AFTER processing
      for (const id of layer) placed.add(id);
      result.push(layer);
      remaining = next;
    }
    return result;
  }, [steps]);

  // Calculate step positions based on layers
  const stepPositions = useMemo(() => {
    const positions = new Map<string, { left: number; width: number }>();
    if (layers.length === 0) return positions;

    const layerWidth = 100 / layers.length;
    const stepMap = new Map(steps.map(s => [s.id, s]));

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const layerLeft = li * layerWidth;
      const stepWidth = layerWidth * 0.85;
      const stepLeft = layerLeft + (layerWidth - stepWidth) / 2;

      for (const id of layer) {
        positions.set(id, { left: stepLeft, width: stepWidth });
      }
    }
    return positions;
  }, [layers, steps]);

  const LANE_H = 80;
  const LANE_GAP = 6;
  const totalH = agents.length * (LANE_H + LANE_GAP);

  // Playhead position based on progress (0-1)
  const playheadX = Math.min(Math.max(progress * 100, 0), 100);

  // Build dependency edges
  const edges = useMemo(() => {
    const result: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const agentY = new Map(agents.map(([agent], i) => [agent, i * (LANE_H + LANE_GAP) + LANE_H / 2]));

    for (const s of steps) {
      const pos = stepPositions.get(s.id);
      if (!pos) continue;
      const deps = Array.isArray(s.dependsOn) ? s.dependsOn : [];
      for (const depId of deps) {
        const depPos = stepPositions.get(depId);
        const dep = steps.find(x => x.id === depId);
        if (!depPos || !dep) continue;
        result.push({
          x1: depPos.left + depPos.width,
          y1: agentY.get(dep.agent) || 0,
          x2: pos.left,
          y2: agentY.get(s.agent) || 0,
        });
      }
    }
    return result;
  }, [steps, agents, stepPositions]);

  return (
    <div className="bg-surface rounded-xl overflow-hidden relative" style={{ minHeight: totalH + 40 }}>
      {/* Time axis */}
      <div className="h-7 bg-surface-alt border-b border-border flex items-center px-3 text-[9px] text-muted-foreground relative">
        {layers.map((layer, i) => {
          const left = (i / Math.max(layers.length, 1)) * 100;
          const width = (1 / Math.max(layers.length, 1)) * 100;
          return (
            <span key={i} className="absolute text-center truncate" style={{ left: `${left}%`, width: `${width}%` }}>
              {layer.length === 1 ? layer[0] : `Layer ${i + 1}`}
            </span>
          );
        })}
      </div>

      {/* Swimlanes + Cards + Edges */}
      <div className="relative" style={{ height: totalH }}>
        {/* SVG edges — use absolute pixel coords */}
        <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%' }}>
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#9ca3af" />
            </marker>
          </defs>
          {edges.map((e, i) => {
            // Convert percentage x to pixels
            const containerW = 1000; // reference width for calc
            const x1px = (e.x1 / 100) * containerW;
            const x2px = (e.x2 / 100) * containerW;
            const dx = Math.abs(x2px - x1px);
            const curve = Math.max(dx * 0.4, 20);
            return (
              <path key={i}
                d={`M ${x1px} ${e.y1} C ${x1px + curve} ${e.y1}, ${x2px - curve} ${e.y2}, ${x2px} ${e.y2}`}
                stroke="#9ca3af" strokeWidth="1.5" fill="none" strokeDasharray="5 3"
                markerEnd="url(#arrowhead)" />
            );
          })}
        </svg>

        {/* Agent swimlanes */}
        {agents.map(([agent, agentSteps], laneIdx) => (
          <div key={agent} className="absolute left-0 right-0" style={{ top: laneIdx * (LANE_H + LANE_GAP), height: LANE_H }}>
            {/* Lane background */}
            <div className={`absolute inset-0 ${laneIdx % 2 === 0 ? 'bg-surface/30' : 'bg-transparent'} rounded`} />
            {/* Agent label */}
            <div className="absolute left-2 top-1 text-[10px] font-semibold text-muted z-10">{agent}</div>
            {/* Step cards */}
            {agentSteps.map(s => {
              const pos = stepPositions.get(s.id);
              if (!pos) return null;
              const color = STATUS_COLORS[s.status] || '#a0aab8';
              const isHovered = hoveredStep === s.id;

              return (
                <div key={s.id}
                  className={`absolute cursor-pointer transition-all ${isHovered ? 'z-20 scale-[1.03]' : 'z-10'}`}
                  style={{
                    left: `${pos.left}%`,
                    top: (LANE_H - 48) / 2,
                    width: `${pos.width}%`,
                    height: 48,
                  }}
                  onMouseEnter={(e) => { setHoveredStep(s.id); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
                  onMouseLeave={() => setHoveredStep(null)}
                  onClick={() => onStepClick?.(s)}>
                  <div className={`h-full rounded-lg px-2.5 py-1.5 flex flex-col justify-between transition-shadow ${isHovered ? 'shadow-lg' : 'shadow-sm'}`}
                    style={{ backgroundColor: color + '12', borderLeft: `3px solid ${color}` }}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-foreground truncate max-w-[75%]">{s.id}</span>
                      <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                        style={{ backgroundColor: color, color: '#fff' }}>
                        {STATUS_ICONS[s.status]}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[8px] text-muted-foreground">
                      {s.completedAt && s.startedAt && <span className="bg-surface-alt px-1 rounded">{fmtDur(s.completedAt - s.startedAt)}</span>}
                      {s.reviewer && <span className="text-info">review</span>}
                      {s.priority === 'critical' && <span className="text-destructive">⚡</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {/* Playhead */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-primary z-30 pointer-events-none transition-all duration-300"
          style={{ left: `${playheadX}%` }}>
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-primary shadow" />
          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-primary shadow" />
        </div>
      </div>

      {/* Tooltip */}
      {hoveredStep && (() => {
        const step = steps.find(s => s.id === hoveredStep);
        if (!step) return null;
        return (
          <div className="fixed z-50 bg-canvas border border-border rounded-xl shadow-xl p-3 max-w-xs pointer-events-none"
            style={{ left: tooltipPos.x + 12, top: tooltipPos.y - 10 }}>
            <p className="text-[12px] font-semibold text-foreground mb-1">{step.id}</p>
            <p className="text-[10px] text-muted-foreground mb-1">{step.agent} · {step.action}</p>
            <p className="text-[10px] mb-1">
              状态: <span style={{ color: STATUS_COLORS[step.status] }}>{STATUS_ICONS[step.status]} {step.status}</span>
            </p>
            {step.startedAt && step.completedAt && (
              <p className="text-[10px] text-muted-foreground">耗时: {fmtDur(step.completedAt - step.startedAt)}</p>
            )}
            {step.prompt && (
              <p className="text-[9px] text-muted-foreground/70 mt-1 line-clamp-2">{step.prompt}</p>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function fmtDur(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
