'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ForceSimulation, type ForceNode, type ForceEdge } from '@/lib/force-simulation';
import { Play, ZoomIn, ZoomOut, Maximize2, Pause, RotateCcw } from 'lucide-react';

// ── Types ──

interface WorkflowStep {
  id: string; type?: string; agent?: string; action?: string; prompt?: string;
  dependsOn?: string[]; routes?: { step: string; when: string }[];
  reviewer?: string; priority?: string; trigger?: any;
}

interface WorkflowDef {
  group: string; name: string; description?: string;
  steps: WorkflowStep[]; position?: { x: number; y: number };
}

interface RunInfo {
  runId: string; status: string; steps: Record<string, string>;
  startedAt: number; completedAt?: number;
}

interface FlowCanvasProps {
  workflows: WorkflowDef[];
  runs: Record<string, RunInfo[]>;
  onSelectWorkflow: (group: string | null) => void;
  selectedGroup: string | null;
  onTrigger: (group: string, triggerStepId?: string) => void;
}

// ── Visual Config ──

const NODE_W = 120, NODE_H = 48, NODE_RX = 14;

const STATUS_STYLE: Record<string, {
  fill: string; stroke: string; shadow: string; textClass: string;
  animClass: string; badgeColor: string;
}> = {
  pending: {
    fill: '#0f172a', stroke: '#334155', shadow: 'none',
    textClass: 'fill-slate-400', animClass: '', badgeColor: '#64748b',
  },
  waiting: {
    fill: '#0f172a', stroke: '#eab308',
    shadow: '0 0 20px rgba(234,179,8,0.25), inset 0 0 15px rgba(234,179,8,0.05)',
    textClass: 'fill-yellow-400', animClass: 'node-breathe', badgeColor: '#eab308',
  },
  in_progress: {
    fill: '#0f172a', stroke: '#3b82f6',
    shadow: '0 0 28px rgba(59,130,246,0.4), 0 0 60px rgba(59,130,246,0.15), inset 0 0 20px rgba(59,130,246,0.08)',
    textClass: 'fill-blue-400', animClass: 'node-active', badgeColor: '#3b82f6',
  },
  completed: {
    fill: '#0f172a', stroke: '#22c55e',
    shadow: '0 0 16px rgba(34,197,94,0.2), inset 0 0 12px rgba(34,197,94,0.05)',
    textClass: 'fill-green-400', animClass: '', badgeColor: '#22c55e',
  },
  failed: {
    fill: '#0f172a', stroke: '#ef4444',
    shadow: '0 0 24px rgba(239,68,68,0.35), inset 0 0 15px rgba(239,68,68,0.08)',
    textClass: 'fill-red-400', animClass: 'node-error', badgeColor: '#ef4444',
  },
  skipped: {
    fill: '#0f172a', stroke: '#475569', shadow: 'none',
    textClass: 'fill-slate-500', animClass: 'node-dim', badgeColor: '#64748b',
  },
};

const TRIGGER_STYLE = {
  fill: '#0f172a', stroke: '#a78bfa',
  shadow: '0 0 20px rgba(167,139,250,0.25), inset 0 0 15px rgba(167,139,250,0.05)',
  textClass: 'fill-violet-400', animClass: 'node-breathe', badgeColor: '#a78bfa',
};

// ── Cell (workflow) colors ──
const CELL_COLORS = [
  { wall: '#6366f1', fill: 'rgba(99,102,241,0.06)', glow: 'rgba(99,102,241,0.15)' },
  { wall: '#8b5cf6', fill: 'rgba(139,92,246,0.06)', glow: 'rgba(139,92,246,0.15)' },
  { wall: '#ec4899', fill: 'rgba(236,72,153,0.06)', glow: 'rgba(236,72,153,0.15)' },
  { wall: '#f59e0b', fill: 'rgba(245,158,11,0.06)', glow: 'rgba(245,158,11,0.15)' },
  { wall: '#10b981', fill: 'rgba(16,185,129,0.06)', glow: 'rgba(16,185,129,0.15)' },
  { wall: '#3b82f6', fill: 'rgba(59,130,246,0.06)', glow: 'rgba(59,130,246,0.15)' },
];

// Convex hull (Andrew's monotone chain)
function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of sorted) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper: { x: number; y: number }[] = [];
  for (const p of sorted.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Expand hull by padding
function expandHull(hull: { x: number; y: number }[], padding: number): { x: number; y: number }[] {
  if (hull.length < 3) return hull;
  return hull.map((p, i) => {
    const prev = hull[(i - 1 + hull.length) % hull.length];
    const next = hull[(i + 1) % hull.length];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // Normal vector (perpendicular, outward)
    const nx = -dy / len;
    const ny = dx / len;
    // Check direction (ensure outward)
    const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
    const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
    const dot = (p.x - cx) * nx + (p.y - cy) * ny;
    const sign = dot >= 0 ? 1 : -1;
    return { x: p.x + nx * padding * sign, y: p.y + ny * padding * sign };
  });
}

// Smooth hull path (cubic bezier through points)
function hullPath(points: { x: number; y: number }[]): string {
  if (points.length < 3) return '';
  const n = points.length;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d + ' Z';
}

const STEP_ICONS: Record<string, string> = {
  trigger: '⚡', test: '🧪', build: '📦', deploy: '🚀', review: '🔍',
  fix: '🔧', verify: '✅', notify: '📢', research: '📚', synthesize: '📝',
  present: '📊', done: '🏁', human_approval: '👤', default: '📋',
};

function getIcon(step: WorkflowStep): string {
  if (step.type === 'trigger') return '⚡';
  const a = (step.action || '').toLowerCase();
  for (const [k, v] of Object.entries(STEP_ICONS)) { if (a.includes(k)) return v; }
  return STEP_ICONS.default;
}

function fmtTime(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}`;
}

// ── Main ──

export default function FlowCanvas({ workflows, runs, onSelectWorkflow, selectedGroup, onTrigger }: FlowCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<ForceSimulation | null>(null);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [zoom, setZoom] = useState(() => { try { return parseFloat(localStorage.getItem('flow-zoom') || '1'); } catch { return 1; } });
  const [pan, setPan] = useState(() => { try { return JSON.parse(localStorage.getItem('flow-pan') || '{"x":0,"y":0}'); } catch { return { x: 0, y: 0 }; } });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [triggerPopup, setTriggerPopup] = useState<{ group: string; triggers: WorkflowStep[] } | null>(null);
  const [time, setTime] = useState(0);

  // Animate time for flowing lines
  useEffect(() => {
    let raf: number;
    const tick = () => { setTime(t => t + 1); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case 'Escape': onSelectWorkflow(null); setTriggerPopup(null); break;
        case '+': case '=': setZoom(z => Math.min(3, z * 1.2)); break;
        case '-': setZoom(z => Math.max(0.15, z / 1.2)); break;
        case '0': setZoom(1); setPan({ x: 0, y: 0 }); break;
        case ' ':
          e.preventDefault();
          if (selectedGroup) onTrigger(selectedGroup);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSelectWorkflow, onTrigger, selectedGroup]);

  // Persist pan/zoom
  useEffect(() => {
    try { localStorage.setItem('flow-pan', JSON.stringify(pan)); } catch {}
  }, [pan]);
  useEffect(() => {
    try { localStorage.setItem('flow-zoom', String(zoom)); } catch {}
  }, [zoom]);

  // ── Build simulation ──
  useEffect(() => {
    const sim = new ForceSimulation({ repulsion: 1800, attraction: 0.025, gravity: 0.008, linkDistance: 200, damping: 0.92, maxVelocity: 6, interGroupRepulsion: 8, groupGravity: 0.04 });
    const allNodes: { id: string; group: string }[] = [];
    const allEdges: ForceEdge[] = [];

    for (let wi = 0; wi < workflows.length; wi++) {
      const wf = workflows[wi];

      for (let si = 0; si < wf.steps.length; si++) {
        const step = wf.steps[si];
        const nid = `${wf.group}:${step.id}`;
        allNodes.push({ id: nid, group: wf.group });
        for (const dep of step.dependsOn || []) {
          allEdges.push({ source: `${wf.group}:${dep}`, target: nid });
        }
      }
    }

    sim.setNodes(allNodes.map((n, i) => ({
      id: n.id, group: n.group,
      x: (Math.random() - 0.5) * 600,
      y: (Math.random() - 0.5) * 400,
    })));
    sim.setEdges(allEdges);
    sim.onTick((nodes: Map<string, any>) => {
      const pos = new Map<string, { x: number; y: number }>();
      for (const [id, n] of nodes) pos.set(id, { x: n.x, y: n.y });
      setPositions(pos);
    });
    sim.start();
    simRef.current = sim;
    return () => sim.stop();
  }, [workflows]);

  // ── Pan / Zoom ──
  const onDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as SVGElement).closest('.node-group')) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);
  const onMove = useCallback((e: React.MouseEvent) => { if (dragging) setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); }, [dragging, dragStart]);
  const onUp = useCallback(() => setDragging(false), []);
  const onWheel = useCallback((e: React.WheelEvent) => { e.preventDefault(); setZoom(z => Math.min(3, Math.max(0.15, z * (e.deltaY > 0 ? 0.92 : 1.08)))); }, []);

  // ── Click ──
  const onNodeClick = useCallback((group: string, step: WorkflowStep) => {
    onSelectWorkflow(group);
  }, [onSelectWorkflow]);

  const onTriggerClick = useCallback((group: string) => {
    const wf = workflows.find(w => w.group === group);
    if (!wf) return;
    const triggers = wf.steps.filter(s => s.type === 'trigger');
    if (triggers.length === 1) onTrigger(group, triggers[0].id);
    else if (triggers.length > 1) setTriggerPopup({ group, triggers });
    else onTrigger(group);
  }, [workflows, onTrigger]);

  // ── Edges ──
  const edges = useMemo(() => {
    const result: { x1: number; y1: number; x2: number; y2: number; active: boolean; key: string }[] = [];
    for (const wf of workflows) {
      for (const step of wf.steps) {
        const to = positions.get(`${wf.group}:${step.id}`);
        if (!to) continue;
        for (const dep of step.dependsOn || []) {
          const from = positions.get(`${wf.group}:${dep}`);
          if (!from) continue;
          const run = runs[wf.group]?.[0];
          const fs = run?.steps?.[dep] || 'pending';
          const ts = run?.steps?.[step.id] || 'pending';
          result.push({
            x1: from.x, y1: from.y, x2: to.x, y2: to.y,
            active: fs === 'completed' && (ts === 'in_progress' || ts === 'waiting'),
            key: `${wf.group}:${dep}->${step.id}`,
          });
        }
      }
    }
    return result;
  }, [workflows, positions, runs]);

  // ── Get step status ──
  const getStepStatus = useCallback((group: string, stepId: string): string => {
    return runs[group]?.[0]?.steps?.[stepId] || 'pending';
  }, [runs]);

  return (
    <div className="relative flex-1 h-full overflow-hidden" style={{ background: 'radial-gradient(ellipse at center, #0f172a 0%, #020617 70%)' }}
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onWheel={onWheel}>
      <svg ref={svgRef} className="w-full h-full" style={{ cursor: dragging ? 'grabbing' : 'grab' }}>
        <defs>
          {/* Grid pattern */}
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.5" opacity="0.3" />
          </pattern>
          {/* Arrow marker */}
          <marker id="arrow" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 3 L 0 6 Z" fill="#475569" opacity="0.6" />
          </marker>
          <marker id="arrow-active" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 3 L 0 6 Z" fill="#3b82f6" />
          </marker>
          {/* Glow filters */}
          {Object.entries({ blue: '#3b82f6', green: '#22c55e', red: '#ef4444', yellow: '#eab308', violet: '#a78bfa' }).map(([name, color]) => (
            <filter key={name} id={`glow-${name}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="6" result="blur" />
              <feFlood floodColor={color} floodOpacity="0.5" result="color" />
              <feComposite in="color" in2="blur" operator="in" result="shadow" />
              <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          ))}
          {/* Cell blob filters — one per workflow color */}
          {CELL_COLORS.map((c, i) => (
            <filter key={`cell-${i}`} id={`cell-blob-${i}`} x="-40%" y="-40%" width="180%" height="180%"
              colorInterpolationFilters="sRGB">
              {/* Blur the source circles into a blob */}
              <feGaussianBlur in="SourceGraphic" stdDeviation="50" result="blur" />
              {/* Threshold: convert blurred alpha to sharp edge */}
              <feColorMatrix in="blur" type="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="blob" />
              {/* Composite: fill with cytoplasm color */}
              <feFlood floodColor={c.fill} floodOpacity="1" result="fill" />
              <feComposite in="fill" in2="blob" operator="in" result="cytoplasm" />
              {/* Extract edge for cell wall */}
              <feMorphology in="blob" operator="dilate" radius="3" result="dilated" />
              <feGaussianBlur in="dilated" stdDeviation="2" result="dilatedBlur" />
              <feComposite in="dilated" in2="dilatedBlur" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="edge" />
              <feFlood floodColor={c.wall} floodOpacity="0.6" result="wallColor" />
              <feComposite in="wallColor" in2="edge" operator="in" result="wall" />
              {/* Merge: cytoplasm + wall */}
              <feMerge>
                <feMergeNode in="cytoplasm" />
                <feMergeNode in="wall" />
              </feMerge>
            </filter>
          ))}
        </defs>

        {/* Grid background */}
        <rect width="100%" height="100%" fill="url(#grid)" />

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* ── Cell blobs (shader-based organic shapes) ── */}
          {workflows.map((wf, wi) => {
            const cellPts = wf.steps
              .map(s => positions.get(`${wf.group}:${s.id}`))
              .filter(Boolean) as { x: number; y: number }[];
            if (cellPts.length === 0) return null;
            const colors = CELL_COLORS[wi % CELL_COLORS.length];
            const isCurrent = wf.group === selectedGroup;
            const opacity = selectedGroup ? (isCurrent ? 1 : 0.08) : 1;

            // Calculate center for label
            const cx = cellPts.reduce((s, p) => s + p.x, 0) / cellPts.length;
            const cy = cellPts.reduce((s, p) => s + p.y, 0) / cellPts.length;

            return (
              <g key={`cell-${wf.group}`} opacity={opacity} style={{ transition: 'opacity 0.6s ease' }}>
                {/* Blob source: large circles at each node position */}
                <g filter={`url(#cell-blob-${wi % CELL_COLORS.length})`}>
                  {cellPts.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={70} fill={colors.fill} stroke="none" />
                  ))}
                </g>
                {/* Label on top */}
                <text x={cx} y={cy - 20} textAnchor="middle" fontSize="12" fontWeight="700"
                  letterSpacing="0.5" fill={colors.wall} opacity={isCurrent ? 1 : 0.4}>
                  {wf.name}
                </text>
                <text x={cx} y={cy - 6} textAnchor="middle" fontSize="9"
                  fill={colors.wall} opacity={isCurrent ? 0.6 : 0.2}>
                  {wf.steps.length} steps · #{wf.group}
                </text>
              </g>
            );
          })}

          {/* ── Edges ── */}
          {edges.map(e => {
            const mx = (e.x1 + e.x2) / 2;
            const my = Math.min(e.y1, e.y2) - 30;
            const dashOffset = -(time * 0.5) % 24;
            return (
              <g key={e.key} opacity={selectedGroup ? 0.3 : 0.7} style={{ transition: 'opacity 0.5s' }}>
                {/* Shadow path */}
                <path d={`M ${e.x1} ${e.y1 + NODE_H / 2} C ${e.x1} ${my}, ${e.x2} ${my}, ${e.x2} ${e.y2 - NODE_H / 2}`}
                  fill="none" stroke={e.active ? 'rgba(59,130,246,0.15)' : 'transparent'} strokeWidth="8" />
                {/* Main path */}
                <path d={`M ${e.x1} ${e.y1 + NODE_H / 2} C ${e.x1} ${my}, ${e.x2} ${my}, ${e.x2} ${e.y2 - NODE_H / 2}`}
                  fill="none" stroke={e.active ? '#3b82f6' : '#334155'}
                  strokeWidth={e.active ? 2 : 1.2}
                  strokeDasharray={e.active ? '10 5' : '4 8'}
                  strokeDashoffset={e.active ? dashOffset : 0}
                  markerEnd={e.active ? 'url(#arrow-active)' : 'url(#arrow)'}
                  style={{ transition: 'stroke 0.3s' }} />
              </g>
            );
          })}

          {/* ── Nodes ── */}
          {workflows.map(wf => {
            const isCurrent = wf.group === selectedGroup;
            const groupOpacity = selectedGroup ? (isCurrent ? 1 : 0.12) : 1;
            const groupFilter = selectedGroup && !isCurrent ? 'blur(6px)' : 'none';

            return (
              <g key={wf.group} opacity={groupOpacity} style={{ filter: groupFilter, transition: 'opacity 0.6s ease, filter 0.6s ease' }}>
                {wf.steps.map(step => {
                  const pos = positions.get(`${wf.group}:${step.id}`);
                  if (!pos) return null;
                  const isTrigger = step.type === 'trigger';
                  const status = getStepStatus(wf.group, step.id);
                  const style = isTrigger ? TRIGGER_STYLE : STATUS_STYLE[status] || STATUS_STYLE.pending;
                  const icon = getIcon(step);
                  const isActive = status === 'in_progress' || status === 'waiting';
                  const isHovered = hoveredNode === `${wf.group}:${step.id}`;
                  const run = runs[wf.group]?.[0];
                  const elapsed = run?.startedAt ? Date.now() - run.startedAt : 0;

                  const filter = isTrigger ? 'url(#glow-violet)'
                    : status === 'in_progress' ? 'url(#glow-blue)'
                    : status === 'completed' ? 'url(#glow-green)'
                    : status === 'failed' ? 'url(#glow-red)'
                    : status === 'waiting' ? 'url(#glow-yellow)'
                    : 'none';

                  return (
                    <g key={step.id} className="node-group" transform={`translate(${pos.x}, ${pos.y})`}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => { setHoveredNode(`${wf.group}:${step.id}`); setHoverPos({ x: e.clientX, y: e.clientY }); }}
                      onMouseMove={(e) => setHoverPos({ x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => { setHoveredNode(null); setHoverPos(null); }}
                      onClick={() => isTrigger ? onTriggerClick(wf.group) : onNodeClick(wf.group, step)}
                    >
                      {/* Glow backdrop */}
                      <rect x={-NODE_W / 2 - 4} y={-NODE_H / 2 - 4} width={NODE_W + 8} height={NODE_H + 8}
                        rx={NODE_RX + 4} fill="none" stroke="none" filter={filter} />

                      {/* Node body */}
                      <rect x={-NODE_W / 2} y={-NODE_H / 2} width={NODE_W} height={NODE_H} rx={NODE_RX}
                        fill={style.fill} stroke={isHovered ? '#e2e8f0' : style.stroke}
                        strokeWidth={isHovered ? 2 : 1.2}
                        strokeDasharray={isTrigger ? '6 3' : 'none'}
                        style={{ transition: 'stroke 0.2s, stroke-width 0.2s' }} />

                      {/* Active pulse ring */}
                      {isActive && (
                        <rect x={-NODE_W / 2 - 2} y={-NODE_H / 2 - 2} width={NODE_W + 4} height={NODE_H + 4}
                          rx={NODE_RX + 2} fill="none" stroke={style.stroke} strokeWidth="1.5"
                          opacity="0.4" className={style.animClass} />
                      )}

                      {/* Icon */}
                      <text x={-NODE_W / 2 + 14} y={4} fontSize="16" dominantBaseline="middle">{icon}</text>

                      {/* Step name */}
                      <text x={-NODE_W / 2 + 34} y={-4} fontSize="11" fontWeight="600" fill="#e2e8f0">
                        {step.id.length > 11 ? step.id.slice(0, 11) + '…' : step.id}
                      </text>

                      {/* Agent */}
                      {step.agent && (
                        <text x={-NODE_W / 2 + 34} y={12} fontSize="9" fill="#94a3b8">{step.agent}</text>
                      )}

                      {/* Status badge */}
                      {status !== 'pending' && (
                        <g transform={`translate(${NODE_W / 2 - 8}, ${-NODE_H / 2 + 8})`}>
                          <circle r="5" fill={style.badgeColor} opacity="0.9" />
                          {status === 'completed' && <text y="3.5" textAnchor="middle" fontSize="7" fill="#fff" fontWeight="700">✓</text>}
                          {status === 'failed' && <text y="3.5" textAnchor="middle" fontSize="7" fill="#fff" fontWeight="700">✗</text>}
                          {status === 'in_progress' && <circle r="2.5" fill="#fff" className="node-spin" />}
                        </g>
                      )}

                      {/* Duration label */}
                      {run && (status === 'in_progress' || status === 'completed') && elapsed > 0 && (
                        <text x={NODE_W / 2 + 12} y={4} fontSize="8" fill="#64748b" dominantBaseline="middle">
                          {fmtTime(elapsed)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>

      {/* ── Zoom controls ── */}
      <div className="absolute bottom-4 left-4 flex items-center gap-1 bg-slate-900/80 backdrop-blur-md rounded-xl border border-slate-700/50 p-1.5 shadow-lg">
        <button onClick={() => setZoom(z => Math.min(3, z * 1.2))} className="p-1.5 hover:bg-slate-800 rounded-lg transition"><ZoomIn size={14} className="text-slate-400" /></button>
        <span className="text-[10px] text-slate-500 w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.max(0.15, z / 1.2))} className="p-1.5 hover:bg-slate-800 rounded-lg transition"><ZoomOut size={14} className="text-slate-400" /></button>
        <div className="w-px h-4 bg-slate-700 mx-0.5" />
        <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="p-1.5 hover:bg-slate-800 rounded-lg transition"><Maximize2 size={14} className="text-slate-400" /></button>
      </div>

      {/* ── Mini map ── */}
      <MiniMap workflows={workflows} positions={positions} zoom={zoom} pan={pan}
        onNavigate={(x, y) => setPan({ x: -x * zoom + window.innerWidth / 2, y: -y * zoom + window.innerHeight / 2 })} />

      {/* ── Hover tooltip ── */}
      {hoveredNode && hoverPos && (() => {
        const [g, sid] = hoveredNode.split(':');
        const wf = workflows.find(w => w.group === g);
        const step = wf?.steps.find(s => s.id === sid);
        if (!step) return null;
        const status = runs[g]?.[0]?.steps?.[sid] || 'pending';
        return (
          <div className="fixed z-[100] pointer-events-none" style={{ left: hoverPos.x + 16, top: hoverPos.y - 8 }}>
            <div className="bg-slate-800 border border-slate-600/50 rounded-xl px-3 py-2 shadow-xl max-w-[240px]">
              <div className="text-[11px] font-medium text-slate-200">{getIcon(step)} {step.id}</div>
              {step.agent && <div className="text-[10px] text-slate-400 mt-0.5">Agent: {step.agent}</div>}
              {step.prompt && <div className="text-[9px] text-slate-500 mt-1 line-clamp-2">{step.prompt.slice(0, 120)}</div>}
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_STYLE[status]?.stroke || '#64748b' }} />
                <span className="text-[9px] text-slate-500">{status}</span>
              </div>
              <div className="text-[8px] text-slate-600 mt-1">Space 触发 · 点击查看详情</div>
            </div>
          </div>
        );
      })()}

      {/* ── Trigger popup ── */}
      {triggerPopup && (
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={() => setTriggerPopup(null)}>
          <div className="bg-slate-900 border border-slate-700/50 rounded-2xl p-5 shadow-2xl w-72" onClick={e => e.stopPropagation()}>
            <h3 className="text-[13px] font-semibold text-slate-200 mb-3">选择触发入口</h3>
            {triggerPopup.triggers.map(t => (
              <button key={t.id} onClick={() => { onTrigger(triggerPopup.group, t.id); setTriggerPopup(null); }}
                className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-slate-800 text-[12px] text-slate-300 flex items-center gap-2.5 mb-1.5 transition">
                <span className="text-[14px]">{getIcon(t)}</span>
                <span className="font-medium">{t.id}</span>
                {t.trigger?.cron && <span className="text-[10px] text-slate-500 ml-auto font-mono">{t.trigger.cron}</span>}
              </button>
            ))}
            <button onClick={() => setTriggerPopup(null)} className="w-full mt-3 px-3 py-2 text-[11px] text-slate-500 hover:bg-slate-800 rounded-xl transition">取消</button>
          </div>
        </div>
      )}

      {/* ── Styles ── */}
      <style jsx global>{`
        @keyframes breathe {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.15; transform: scale(1.06); }
        }
        .node-breathe { animation: breathe 3s ease-in-out infinite; transform-origin: center; }
        @keyframes active-pulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 0.2; transform: scale(1.1); }
        }
        .node-active { animation: active-pulse 2s ease-in-out infinite; transform-origin: center; }
        @keyframes error-shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-3px); }
          75% { transform: translateX(3px); }
        }
        .node-error { animation: error-shake 0.5s ease-in-out infinite; }
        @keyframes dim { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.3; } }
        .node-dim { animation: dim 4s ease-in-out infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .node-spin { animation: spin 1.5s linear infinite; transform-origin: center; }
      `}</style>
    </div>
  );
}

// ── Mini Map ──

function MiniMap({ workflows, positions, zoom, pan, onNavigate }: {
  workflows: WorkflowDef[]; positions: Map<string, { x: number; y: number }>;
  zoom: number; pan: { x: number; y: number }; onNavigate: (x: number, y: number) => void;
}) {
  const W = 180, H = 110;
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [, p] of positions) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    if (minX === Infinity) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    const pad = 150;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }, [positions]);

  const sx = W / (bounds.maxX - bounds.minX);
  const sy = H / (bounds.maxY - bounds.minY);
  const s = Math.min(sx, sy);

  return (
    <div className="absolute bottom-4 right-4 bg-slate-900/80 backdrop-blur-md border border-slate-700/50 rounded-xl overflow-hidden shadow-lg"
      style={{ width: W, height: H }}>
      <svg width={W} height={H}>
        {workflows.map(wf => wf.steps.map(step => {
          const p = positions.get(`${wf.group}:${step.id}`);
          if (!p) return null;
          return <circle key={`${wf.group}:${step.id}`} cx={(p.x - bounds.minX) * s} cy={(p.y - bounds.minY) * s} r={2.5}
            fill={step.type === 'trigger' ? '#a78bfa' : '#6366f1'} opacity={0.7} />;
        }))}
        <rect x={(-pan.x / zoom - bounds.minX) * s} y={(-pan.y / zoom - bounds.minY) * s}
          width={(typeof window !== 'undefined' ? window.innerWidth : 1200 / zoom) * s}
          height={(typeof window !== 'undefined' ? window.innerHeight : 800 / zoom) * s}
          fill="none" stroke="#6366f1" strokeWidth="1.5" rx="2" opacity="0.6" />
      </svg>
    </div>
  );
}
