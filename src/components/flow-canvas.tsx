'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ForceSimulation, type ForceNode, type ForceEdge } from '@/lib/force-simulation';
import { Play, ZoomIn, ZoomOut, Maximize2, GitBranch } from 'lucide-react';

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
  runs: Record<string, RunInfo[]>;  // group → runs
  onSelectWorkflow: (group: string | null) => void;
  selectedGroup: string | null;
  onTrigger: (group: string, triggerStepId?: string) => void;
}

// ── Status colors ──

const STATUS_COLORS: Record<string, { fill: string; stroke: string; glow: string }> = {
  pending:    { fill: '#1e293b', stroke: '#475569', glow: 'none' },
  waiting:    { fill: '#1e293b', stroke: '#eab308', glow: '0 0 12px rgba(234,179,8,0.4)' },
  in_progress:{ fill: '#1e293b', stroke: '#3b82f6', glow: '0 0 20px rgba(59,130,246,0.6)' },
  completed:  { fill: '#1e293b', stroke: '#22c55e', glow: '0 0 8px rgba(34,197,94,0.3)' },
  failed:     { fill: '#1e293b', stroke: '#ef4444', glow: '0 0 16px rgba(239,68,68,0.5)' },
  skipped:    { fill: '#1e293b', stroke: '#6b7280', glow: 'none' },
};

const TRIGGER_COLORS = { fill: '#1e293b', stroke: '#8b5cf6', glow: '0 0 12px rgba(139,92,246,0.3)' };

const NODE_ICONS: Record<string, string> = {
  trigger: '⚡', test: '🧪', build: '📦', deploy: '🚀', review: '🔍',
  fix: '🔧', verify: '✅', notify: '📢', research: '📚', synthesize: '📝',
  present: '📊', done: '🏁', human_approval: '👤', default: '📋',
};

function getStepIcon(step: WorkflowStep): string {
  if (step.type === 'trigger') return '⚡';
  const action = (step.action || '').toLowerCase();
  for (const [key, icon] of Object.entries(NODE_ICONS)) {
    if (action.includes(key)) return icon;
  }
  return NODE_ICONS.default;
}

// ── Main Component ──

export default function FlowCanvas({ workflows, runs, onSelectWorkflow, selectedGroup, onTrigger }: FlowCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<ForceSimulation | null>(null);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<{ group: string; step: WorkflowStep } | null>(null);

  // ── Build simulation from all workflows ──
  useEffect(() => {
    const sim = new ForceSimulation({ repulsion: 1500, attraction: 0.03, gravity: 0.01, linkDistance: 180 });
    const allNodes: { id: string; group: string; step: WorkflowStep }[] = [];
    const allEdges: ForceEdge[] = [];

    for (const wf of workflows) {
      const offsetX = wf.position?.x || 0;
      const offsetY = wf.position?.y || 0;

      for (const step of wf.steps) {
        allNodes.push({ id: `${wf.group}:${step.id}`, group: wf.group, step });
        for (const dep of step.dependsOn || []) {
          allEdges.push({ source: `${wf.group}:${dep}`, target: `${wf.group}:${step.id}` });
        }
      }
    }

    sim.setNodes(allNodes.map((n, i) => ({
      id: n.id,
      x: (n.group === selectedGroup ? 0 : workflows.findIndex(w => w.group === n.group) * 500) + (Math.random() - 0.5) * 200,
      y: i * 80 - allNodes.length * 40,
    })));
    sim.setEdges(allEdges);

    sim.onTick((nodes) => {
      const pos = new Map<string, { x: number; y: number }>();
      for (const [id, n] of nodes) pos.set(id, { x: n.x, y: n.y });
      setPositions(pos);
    });

    sim.start();
    simRef.current = sim;

    return () => sim.stop();
  }, [workflows, selectedGroup]);

  // ── Pan handling ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === svgRef.current || (e.target as SVGElement).tagName === 'rect') {
      setDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragging) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  }, [dragging, dragStart]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  // ── Zoom handling ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.min(3, Math.max(0.2, z * delta)));
  }, []);

  // ── Node click ──
  const handleNodeClick = useCallback((group: string, step: WorkflowStep) => {
    onSelectWorkflow(group);
    setSelectedNode({ group, step });
  }, [onSelectWorkflow]);

  // ── Build edges for rendering ──
  const edges = useMemo(() => {
    const result: { x1: number; y1: number; x2: number; y2: number; label?: string; active: boolean }[] = [];
    for (const wf of workflows) {
      for (const step of wf.steps) {
        const toPos = positions.get(`${wf.group}:${step.id}`);
        if (!toPos) continue;
        for (const dep of step.dependsOn || []) {
          const fromPos = positions.get(`${wf.group}:${dep}`);
          if (!fromPos) continue;
          const run = runs[wf.group]?.[0];
          const fromStatus = run?.steps?.[dep] || 'pending';
          const toStatus = run?.steps?.[step.id] || 'pending';
          result.push({
            x1: fromPos.x, y1: fromPos.y,
            x2: toPos.x, y2: toPos.y,
            active: fromStatus === 'completed' && (toStatus === 'in_progress' || toStatus === 'waiting'),
          });
        }
      }
    }
    return result;
  }, [workflows, positions, runs]);

  // ── Trigger popup ──
  const [triggerPopup, setTriggerPopup] = useState<{ group: string; triggers: WorkflowStep[] } | null>(null);

  const handleTriggerClick = useCallback((group: string) => {
    const wf = workflows.find(w => w.group === group);
    if (!wf) return;
    const triggers = wf.steps.filter(s => s.type === 'trigger');
    if (triggers.length === 1) {
      onTrigger(group, triggers[0].id);
    } else if (triggers.length > 1) {
      setTriggerPopup({ group, triggers });
    } else {
      onTrigger(group);
    }
  }, [workflows, onTrigger]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0a0a0f]" onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onWheel={handleWheel}>
      {/* ── SVG Canvas ── */}
      <svg ref={svgRef} className="w-full h-full" style={{ cursor: dragging ? 'grabbing' : 'grab' }}>
        <defs>
          {/* Flowing line gradient */}
          <linearGradient id="flow-active" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#3b82f6" stopOpacity="1" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id="flow-idle" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#475569" stopOpacity="0.2" />
            <stop offset="50%" stopColor="#475569" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#475569" stopOpacity="0.2" />
          </linearGradient>
          {/* Glow filter */}
          <filter id="glow-blue"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <filter id="glow-green"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <filter id="glow-red"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <filter id="glow-yellow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <filter id="glow-purple"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* ── Edges ── */}
          {edges.map((e, i) => {
            const mx = (e.x1 + e.x2) / 2;
            const my = (e.y1 + e.y2) / 2 - 20;
            return (
              <g key={i}>
                <path
                  d={`M ${e.x1} ${e.y1 + 30} Q ${mx} ${my} ${e.x2} ${e.y2 - 30}`}
                  fill="none"
                  stroke={e.active ? 'url(#flow-active)' : 'url(#flow-idle)'}
                  strokeWidth={e.active ? 2.5 : 1.5}
                  strokeDasharray={e.active ? '8 4' : '4 8'}
                  className={e.active ? 'animate-flow' : ''}
                  opacity={e.active ? 1 : 0.5}
                />
                {e.label && (
                  <text x={mx} y={my - 8} textAnchor="middle" className="fill-muted-foreground" fontSize="10">{e.label}</text>
                )}
              </g>
            );
          })}

          {/* ── Nodes ── */}
          {workflows.map(wf => {
            const isCurrentGroup = wf.group === selectedGroup;
            const opacity = selectedGroup ? (isCurrentGroup ? 1 : 0.15) : 1;
            const blur = selectedGroup && !isCurrentGroup ? 'blur(4px)' : 'none';

            return (
              <g key={wf.group} opacity={opacity} style={{ filter: blur, transition: 'opacity 0.5s, filter 0.5s' }}>
                {/* Workflow label */}
                {wf.steps[0] && positions.get(`${wf.group}:${wf.steps[0].id}`) && (() => {
                  const p = positions.get(`${wf.group}:${wf.steps[0].id}`)!;
                  return <text x={p.x} y={p.y - 50} textAnchor="middle" className="fill-muted-foreground" fontSize="12" fontWeight="600">{wf.name}</text>;
                })()}

                {wf.steps.map(step => {
                  const pos = positions.get(`${wf.group}:${step.id}`);
                  if (!pos) return null;
                  const isTrigger = step.type === 'trigger';
                  const run = runs[wf.group]?.[0];
                  const status = run?.steps?.[step.id] || 'pending';
                  const colors = isTrigger ? TRIGGER_COLORS : STATUS_COLORS[status] || STATUS_COLORS.pending;
                  const icon = getStepIcon(step);
                  const isHovered = hoveredNode === `${wf.group}:${step.id}`;
                  const isActive = status === 'in_progress' || status === 'waiting';
                  const filter = isTrigger ? 'url(#glow-purple)'
                    : status === 'in_progress' ? 'url(#glow-blue)'
                    : status === 'completed' ? 'url(#glow-green)'
                    : status === 'failed' ? 'url(#glow-red)'
                    : status === 'waiting' ? 'url(#glow-yellow)'
                    : 'none';

                  return (
                    <g key={step.id}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredNode(`${wf.group}:${step.id}`)}
                      onMouseLeave={() => setHoveredNode(null)}
                      onClick={() => handleNodeClick(wf.group, step)}
                    >
                      {/* Node background */}
                      <rect
                        x={-55} y={-22} width={110} height={44} rx={isTrigger ? 8 : 12}
                        fill={colors.fill}
                        stroke={colors.stroke}
                        strokeWidth={isHovered ? 2.5 : 1.5}
                        strokeDasharray={isTrigger ? '6 3' : 'none'}
                        filter={filter}
                        style={{ transition: 'stroke 0.3s, filter 0.5s' }}
                      />

                      {/* Pulse animation for active nodes */}
                      {isActive && (
                        <rect x={-55} y={-22} width={110} height={44} rx={isTrigger ? 8 : 12}
                          fill="none" stroke={colors.stroke} strokeWidth="2" opacity="0.5"
                          className="animate-pulse-ring" />
                      )}

                      {/* Icon */}
                      <text x={-40} y={5} fontSize="16" dominantBaseline="middle">{icon}</text>

                      {/* Step name */}
                      <text x={-22} y={-4} className="fill-foreground" fontSize="11" fontWeight="500">
                        {step.id.length > 10 ? step.id.slice(0, 10) + '…' : step.id}
                      </text>

                      {/* Agent name */}
                      {step.agent && (
                        <text x={-22} y={12} className="fill-muted-foreground" fontSize="9">
                          {step.agent}
                        </text>
                      )}

                      {/* Status indicator */}
                      {status === 'in_progress' && (
                        <circle cx={42} cy={0} r={4} fill={colors.stroke} className="animate-spin-slow" />
                      )}
                      {status === 'completed' && (
                        <text x={42} y={4} fontSize="12" textAnchor="middle" fill="#22c55e">✓</text>
                      )}
                      {status === 'failed' && (
                        <text x={42} y={4} fontSize="12" textAnchor="middle" fill="#ef4444">✗</text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>

      {/* ── Zoom Controls ── */}
      <div className="absolute bottom-4 left-4 flex items-center gap-1 bg-surface/80 backdrop-blur-sm rounded-xl border border-border p-1">
        <button onClick={() => setZoom(z => Math.min(3, z * 1.2))} className="p-1.5 hover:bg-surface-alt rounded-lg"><ZoomIn size={14} className="text-muted" /></button>
        <span className="text-[10px] text-muted-foreground w-10 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.max(0.2, z / 1.2))} className="p-1.5 hover:bg-surface-alt rounded-lg"><ZoomOut size={14} className="text-muted" /></button>
        <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="p-1.5 hover:bg-surface-alt rounded-lg"><Maximize2 size={14} className="text-muted" /></button>
      </div>

      {/* ── Mini Map ── */}
      <MiniMap workflows={workflows} positions={positions} zoom={zoom} pan={pan} onNavigate={(x, y) => setPan({ x: -x * zoom + window.innerWidth / 2, y: -y * zoom + window.innerHeight / 2 })} />

      {/* ── Trigger Popup ── */}
      {triggerPopup && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-canvas border border-border rounded-2xl p-4 shadow-2xl z-50 w-64" onClick={e => e.stopPropagation()}>
          <h3 className="text-[13px] font-semibold text-foreground mb-3">选择触发入口</h3>
          {triggerPopup.triggers.map(t => (
            <button key={t.id} onClick={() => { onTrigger(triggerPopup.group, t.id); setTriggerPopup(null); }}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface text-[12px] text-foreground flex items-center gap-2 mb-1">
              <span>{getStepIcon(t)}</span> {t.id}
              {t.trigger?.cron && <span className="text-[10px] text-muted-foreground ml-auto">{t.trigger.cron}</span>}
            </button>
          ))}
          <button onClick={() => setTriggerPopup(null)} className="w-full mt-2 px-3 py-1.5 text-[11px] text-muted hover:bg-surface rounded-lg">取消</button>
        </div>
      )}

      {/* ── Click on background to deselect ── */}
      <style jsx global>{`
        @keyframes flow { to { stroke-dashoffset: -12; } }
        .animate-flow { animation: flow 0.8s linear infinite; }
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.08); opacity: 0.2; }
          100% { transform: scale(1); opacity: 0.5; }
        }
        .animate-pulse-ring { animation: pulse-ring 2s ease-in-out infinite; }
        @keyframes spin-slow { to { transform: rotate(360deg); } }
        .animate-spin-slow { animation: spin-slow 2s linear infinite; transform-origin: center; }
      `}</style>
    </div>
  );
}

// ── Mini Map ──

function MiniMap({ workflows, positions, zoom, pan, onNavigate }: {
  workflows: WorkflowDef[]; positions: Map<string, { x: number; y: number }>;
  zoom: number; pan: { x: number; y: number }; onNavigate: (x: number, y: number) => void;
}) {
  const W = 160, H = 100;
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [, p] of positions) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    if (minX === Infinity) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    const pad = 100;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }, [positions]);

  const scaleX = W / (bounds.maxX - bounds.minX);
  const scaleY = H / (bounds.maxY - bounds.minY);
  const scale = Math.min(scaleX, scaleY);

  return (
    <div className="absolute bottom-4 right-4 bg-surface/80 backdrop-blur-sm border border-border rounded-xl overflow-hidden" style={{ width: W, height: H }}>
      <svg width={W} height={H}>
        {workflows.map(wf => {
          const steps = wf.steps.filter(s => positions.has(`${wf.group}:${s.id}`));
          return steps.map(step => {
            const p = positions.get(`${wf.group}:${step.id}`)!;
            const x = (p.x - bounds.minX) * scale;
            const y = (p.y - bounds.minY) * scale;
            return <circle key={`${wf.group}:${step.id}`} cx={x} cy={y} r={2} fill="#6366f1" opacity={0.6} />;
          });
        })}
        {/* Viewport indicator */}
        <rect
          x={(-pan.x / zoom - bounds.minX) * scale}
          y={(-pan.y / zoom - bounds.minY) * scale}
          width={(window.innerWidth / zoom) * scale}
          height={(window.innerHeight / zoom) * scale}
          fill="none" stroke="#6366f1" strokeWidth="1" opacity="0.5"
        />
      </svg>
    </div>
  );
}
