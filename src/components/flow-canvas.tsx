'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ForceSimulation, type ForceNode, type ForceEdge } from '@/lib/force-simulation';
import FlowShaderCanvas from './flow-shader-canvas';
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
      {/* ── WebGL shader canvas (all visuals) ── */}
      <FlowShaderCanvas
        width={typeof window !== 'undefined' ? window.innerWidth : 1200}
        height={typeof window !== 'undefined' ? window.innerHeight : 800}
        zoom={zoom} pan={pan} time={time}
        cells={workflows.map((wf, wi) => ({
          nodes: wf.steps.map(s => positions.get(`${wf.group}:${s.id}`)).filter(Boolean) as { x: number; y: number }[],
          colorIdx: wi,
        }))}
        nodes={workflows.flatMap(wf => wf.steps.map(s => {
          const pos = positions.get(`${wf.group}:${s.id}`);
          if (!pos) return null;
          const isTrigger = s.type === 'trigger';
          const status = getStepStatus(wf.group, s.id);
          const statusNum = isTrigger ? 5 : { pending: 0, waiting: 1, in_progress: 2, completed: 3, failed: 4 }[status] || 0;
          return { x: pos.x, y: pos.y, status: statusNum, isHovered: hoveredNode === `${wf.group}:${s.id}` ? 1 : 0 };
        }).filter(Boolean) as any[])}
        edges={edges.map(e => ({ x1: e.x1, y1: e.y1 + 28, x2: e.x2, y2: e.y2 - 28, active: e.active ? 1 : 0 }))}
      />

      {/* ── SVG overlay: transparent click areas + labels ── */}
      <svg ref={svgRef} className="w-full h-full" style={{ cursor: dragging ? 'grabbing' : 'grab', position: 'relative', zIndex: 1 }}>
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Cell labels */}
          {workflows.map((wf, wi) => {
            const cellPts = wf.steps.map(s => positions.get(`${wf.group}:${s.id}`)).filter(Boolean) as { x: number; y: number }[];
            if (cellPts.length === 0) return null;
            const isCurrent = wf.group === selectedGroup;
            const opacity = selectedGroup ? (isCurrent ? 1 : 0.15) : 0.9;
            const cx = cellPts.reduce((s, p) => s + p.x, 0) / cellPts.length;
            const cy = cellPts.reduce((s, p) => s + p.y, 0) / cellPts.length;
            const CC = [[0.388,0.400,0.945],[0.545,0.361,0.965],[0.925,0.282,0.600],[0.961,0.620,0.043],[0.063,0.725,0.502],[0.231,0.510,0.965]];
            const c = CC[wi % CC.length];
            const wallColor = `rgb(${Math.round(c[0]*255)},${Math.round(c[1]*255)},${Math.round(c[2]*255)})`;
            return (
              <g key={`lbl-${wf.group}`} opacity={opacity}>
                <text x={cx} y={cy - 45} textAnchor="middle" fontSize="13" fontWeight="700" letterSpacing="0.5" fill={wallColor}>{wf.name}</text>
                <text x={cx} y={cy - 30} textAnchor="middle" fontSize="9" fill={wallColor} opacity="0.5">{wf.steps.length} steps · #{wf.group}</text>
              </g>
            );
          })}

          {/* Transparent click targets for nodes */}
          {workflows.map(wf => wf.steps.map(step => {
            const pos = positions.get(`${wf.group}:${step.id}`);
            if (!pos) return null;
            return (
              <circle key={`hit-${wf.group}:${step.id}`} cx={pos.x} cy={pos.y} r={30}
                fill="transparent" style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => { setHoveredNode(`${wf.group}:${step.id}`); setHoverPos({ x: e.clientX, y: e.clientY }); }}
                onMouseMove={(e) => setHoverPos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => { setHoveredNode(null); setHoverPos(null); }}
                onClick={() => step.type === 'trigger' ? onTriggerClick(wf.group) : onNodeClick(wf.group, step)} />
            );
          }))}
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
