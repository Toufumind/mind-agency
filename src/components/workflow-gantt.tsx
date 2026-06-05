'use client';

import { useState, useRef, useEffect, useMemo } from 'react';

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
  runStartedAt?: number;
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

const STATUS_LABELS: Record<string, string> = {
  pending: '等待中',
  in_progress: '执行中',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
  blocked: '被阻塞',
};

export default function WorkflowGantt({ steps, runStartedAt, onStepClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredStep, setHoveredStep] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update playhead every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Group steps by agent (swimlanes)
  const agents = useMemo(() => {
    const agentMap = new Map<string, StepData[]>();
    for (const s of steps) {
      const lane = agentMap.get(s.agent) || [];
      lane.push(s);
      agentMap.set(s.agent, lane);
    }
    return [...agentMap.entries()];
  }, [steps]);

  // Calculate time bounds
  const timeBounds = useMemo(() => {
    const starts = steps.filter(s => s.startedAt).map(s => s.startedAt!);
    const ends = steps.filter(s => s.completedAt).map(s => s.completedAt!);
    if (starts.length === 0 && ends.length === 0) {
      return { start: Date.now() - 60000, end: Date.now() + 60000 };
    }
    const minStart = Math.min(...starts, ...(ends.length > 0 ? [Math.min(...ends)] : [Date.now()]));
    const maxEnd = Math.max(...ends, Date.now());
    const padding = (maxEnd - minStart) * 0.1 || 30000;
    return { start: minStart - padding, end: maxEnd + padding };
  }, [steps]);

  const timeToX = (time: number) => {
    const range = timeBounds.end - timeBounds.start;
    return range > 0 ? ((time - timeBounds.start) / range) * 100 : 0;
  };

  const LANE_H = 100;
  const CARD_H = 56;
  const LANE_GAP = 8;
  const totalH = agents.length * (LANE_H + LANE_GAP);

  // Build dependency edges
  const edges = useMemo(() => {
    const result: Array<{ x1: number; y1: number; x2: number; y2: number; status: string }> = [];
    const stepMap = new Map(steps.map(s => [s.id, s]));
    const agentY = new Map(agents.map(([agent], i) => [agent, i * (LANE_H + LANE_GAP) + LANE_H / 2]));

    for (const s of steps) {
      if (!s.startedAt || !s.dependsOn) continue;
      const deps = Array.isArray(s.dependsOn) ? s.dependsOn : [];
      for (const depId of deps) {
        const dep = stepMap.get(depId);
        if (!dep || !dep.completedAt) continue;
        const depY = agentY.get(dep.agent) || 0;
        const targetY = agentY.get(s.agent) || 0;
        result.push({
          x1: timeToX(dep.completedAt),
          y1: depY,
          x2: timeToX(s.startedAt || Date.now()),
          y2: targetY,
          status: s.status,
        });
      }
    }
    return result;
  }, [steps, agents, timeBounds]);

  const playheadX = timeToX(currentTime);

  return (
    <div ref={containerRef} className="bg-surface rounded-xl overflow-hidden relative" style={{ minHeight: totalH + 60 }}>
      {/* Time axis */}
      <div className="h-8 bg-surface-alt border-b border-border flex items-center px-3 text-[9px] text-muted-foreground">
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => (
          <span key={i} style={{ position: 'absolute', left: `${pct * 100}%`, transform: 'translateX(-50%)' }}>
            {formatDuration((timeBounds.start + pct * (timeBounds.end - timeBounds.start)) - timeBounds.start)}
          </span>
        ))}
      </div>

      {/* Swimlanes + Cards + Edges */}
      <div className="relative" style={{ height: totalH }}>
        {/* SVG edges */}
        <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%' }}>
          <defs>
            <marker id="arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
              <polygon points="0 0, 6 2, 0 4" fill="#9ca3af" />
            </marker>
          </defs>
          {edges.map((e, i) => (
            <line key={i}
              x1={`${e.x1}%`} y1={e.y1} x2={`${e.x2}%`} y2={e.y2}
              stroke="#d1d5db" strokeWidth="1.5" markerEnd="url(#arrow)" />
          ))}
        </svg>

        {/* Agent swimlanes */}
        {agents.map(([agent, agentSteps], laneIdx) => (
          <div key={agent} className="absolute left-0 right-0" style={{ top: laneIdx * (LANE_H + LANE_GAP), height: LANE_H }}>
            {/* Lane background */}
            <div className={`absolute inset-0 ${laneIdx % 2 === 0 ? 'bg-surface/50' : 'bg-transparent'}`} />
            {/* Agent label */}
            <div className="absolute left-2 top-1 text-[10px] font-medium text-muted-foreground z-10">{agent}</div>
            {/* Step cards */}
            {agentSteps.map(s => {
              if (!s.startedAt) return null;
              const left = timeToX(s.startedAt);
              const width = s.completedAt
                ? Math.max(timeToX(s.completedAt) - left, 2)
                : Math.max(timeToX(currentTime) - left, 2);
              const color = STATUS_COLORS[s.status] || '#a0aab8';
              const isHovered = hoveredStep === s.id;

              return (
                <div key={s.id}
                  className={`absolute cursor-pointer transition-all ${isHovered ? 'z-20 scale-105' : 'z-10'}`}
                  style={{
                    left: `${left}%`,
                    top: (LANE_H - CARD_H) / 2,
                    width: `${Math.max(width, 3)}%`,
                    height: CARD_H,
                  }}
                  onMouseEnter={(e) => { setHoveredStep(s.id); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
                  onMouseLeave={() => setHoveredStep(null)}
                  onClick={() => onStepClick?.(s)}>
                  <div className={`h-full rounded-lg px-2.5 py-1.5 flex flex-col justify-between transition-shadow ${isHovered ? 'shadow-lg' : 'shadow-sm'}`}
                    style={{ backgroundColor: color + '18', border: `2px solid ${color}` }}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-foreground truncate max-w-[80%]">{s.id}</span>
                      <span className="text-[8px] px-1.5 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: color }}>
                        {STATUS_LABELS[s.status]}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                      {s.completedAt && s.startedAt && (
                        <span>{formatDuration(s.completedAt - s.startedAt)}</span>
                      )}
                      {s.reviewer && <span>· 👁 {s.reviewer}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {/* Playhead */}
        <div className="absolute top-0 bottom-0 w-px bg-primary z-30 pointer-events-none"
          style={{ left: `${playheadX}%` }}>
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-primary" />
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-primary" />
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
            <p className="text-[10px] text-muted-foreground mb-1">
              状态: <span style={{ color: STATUS_COLORS[step.status] }}>{STATUS_LABELS[step.status]}</span>
            </p>
            {step.startedAt && step.completedAt && (
              <p className="text-[10px] text-muted-foreground">耗时: {formatDuration(step.completedAt - step.startedAt)}</p>
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
