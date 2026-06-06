'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ForceSimulation, type ForceEdge } from '@/lib/force-simulation';
import FlowGPU, { CELL_PALETTE } from './flow-gpu';
import { useTheme } from '@/lib/theme';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

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

// ── Component ──

export default function FlowCanvas({ workflows, runs, onSelectWorkflow, selectedGroup, onTrigger }: FlowCanvasProps) {
  const { theme } = useTheme();
  const isDark = !['notion', 'minimal-white', 'warm-wood', 'solarized-light'].includes(theme);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [zoom, setZoom] = useState(() => { try { return parseFloat(localStorage.getItem('flow-zoom') || '1'); } catch { return 1; } });
  const [pan, setPan] = useState(() => { try { return JSON.parse(localStorage.getItem('flow-pan') || '{"x":0,"y":0}'); } catch { return { x: 0, y: 0 }; } });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [triggerPopup, setTriggerPopup] = useState<{ group: string; triggers: WorkflowStep[] } | null>(null);
  const [time, setTime] = useState(0);
  const simRef = useRef<ForceSimulation | null>(null);

  // Animation loop
  useEffect(() => {
    let raf: number;
    const tick = () => { setTime(t => t + 1); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') { onSelectWorkflow(null); setTriggerPopup(null); }
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(3, z * 1.2));
      if (e.key === '-') setZoom(z => Math.max(0.15, z / 1.2));
      if (e.key === '0') { setZoom(1); setPan({ x: 0, y: 0 }); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onSelectWorkflow]);

  // Persist
  useEffect(() => { try { localStorage.setItem('flow-pan', JSON.stringify(pan)); } catch {} }, [pan]);
  useEffect(() => { try { localStorage.setItem('flow-zoom', String(zoom)); } catch {} }, [zoom]);

  // Force simulation
  useEffect(() => {
    try {
      const sim = new ForceSimulation({
        repulsion: 1800, attraction: 0.025, gravity: 0.008,
        linkDistance: 200, damping: 0.92, maxVelocity: 6,
        interGroupRepulsion: 8, groupGravity: 0.04,
      });
      const allNodes: { id: string; group: string }[] = [];
      const allEdges: ForceEdge[] = [];
      for (const wf of workflows) {
        for (const step of wf.steps) {
          allNodes.push({ id: `${wf.group}:${step.id}`, group: wf.group });
          for (const dep of step.dependsOn || []) allEdges.push({ source: `${wf.group}:${dep}`, target: `${wf.group}:${step.id}` });
        }
      }
      sim.setNodes(allNodes.map(n => ({ id: n.id, group: n.group, x: (Math.random() - 0.5) * 600, y: (Math.random() - 0.5) * 400 })));
      sim.setEdges(allEdges);
      sim.onTick((nodes) => {
        const pos = new Map<string, { x: number; y: number }>();
        for (const [id, n] of nodes) pos.set(id, { x: n.x, y: n.y });
        setPositions(pos);
      });
      sim.start();
      simRef.current = sim;
      return () => sim.stop();
    } catch (e) { console.error('Sim:', e); }
  }, [workflows]);

  // Pan/Zoom
  const onDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as SVGElement).closest('[data-node-idx]')) return;
    setDragging(true); setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);
  const onMove = useCallback((e: React.MouseEvent) => { if (dragging) setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); }, [dragging, dragStart]);
  const onUp = useCallback(() => setDragging(false), []);
  const onWheel = useCallback((e: React.WheelEvent) => { e.preventDefault(); setZoom(z => Math.min(3, Math.max(0.15, z * (e.deltaY > 0 ? 0.92 : 1.08)))); }, []);

  const getStepStatus = useCallback((group: string, stepId: string): string => runs[group]?.[0]?.steps?.[stepId] || 'pending', [runs]);

  // Build GPU data
  const gpuData = useMemo(() => {
    const cellNodes: number[][] = [];
    const cellColors: number[][] = [];
    const cellLabels: { text: string; x: number; y: number; color: number[] }[] = [];
    const nodeX: number[] = [], nodeY: number[] = [], nodeStatus: number[] = [], nodeHover: number[] = [];
    const nodeLabels: { text: string; x: number; y: number }[] = [];
    const edgeX1: number[] = [], edgeY1: number[] = [], edgeX2: number[] = [], edgeY2: number[] = [], edgeActive: number[] = [];

    for (let wi = 0; wi < workflows.length; wi++) {
      const wf = workflows[wi];
      const color = CELL_PALETTE[wi % CELL_PALETTE.length];
      const pts: number[] = [];
      for (const step of wf.steps) {
        const p = positions.get(`${wf.group}:${step.id}`);
        if (!p) continue;
        pts.push(p.x, p.y);
        const isTrigger = step.type === 'trigger';
        const status = getStepStatus(wf.group, step.id);
        const statusNum = isTrigger ? 5 : ({ pending: 0, waiting: 1, in_progress: 2, completed: 3, failed: 4 } as Record<string, number>)[status] || 0;
        nodeX.push(p.x); nodeY.push(p.y);
        nodeStatus.push(statusNum);
        nodeHover.push(hoveredNode === `${wf.group}:${step.id}` ? 1 : 0);
        nodeLabels.push({ text: step.id, x: p.x, y: p.y });
      }
      cellNodes.push(pts);
      cellColors.push(color);
      // Cell label at center
      if (pts.length >= 2) {
        let cx = 0, cy = 0;
        for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cy += pts[i + 1]; }
        cx /= pts.length / 2; cy /= pts.length / 2;
        cellLabels.push({ text: wf.name, x: cx, y: cy - 35, color });
      }
    }

    // Edges
    for (const wf of workflows) {
      for (const step of wf.steps) {
        const to = positions.get(`${wf.group}:${step.id}`);
        if (!to) continue;
        for (const dep of step.dependsOn || []) {
          const from = positions.get(`${wf.group}:${dep}`);
          if (!from) continue;
          const run = runs[wf.group]?.[0];
          const fs_ = run?.steps?.[dep] || 'pending';
          const ts = run?.steps?.[step.id] || 'pending';
          edgeX1.push(from.x); edgeY1.push(from.y + 27);
          edgeX2.push(to.x); edgeY2.push(to.y - 27);
          edgeActive.push(fs_ === 'completed' && (ts === 'in_progress' || ts === 'waiting') ? 1 : 0);
        }
      }
    }

    return { cellNodes, cellColors, cellLabels, nodeX, nodeY, nodeStatus, nodeHover, nodeLabels, edgeX1, edgeY1, edgeX2, edgeY2, edgeActive };
  }, [workflows, positions, runs, hoveredNode, getStepStatus]);

  // Trigger popup
  const onTriggerClick = useCallback((group: string) => {
    const wf = workflows.find(w => w.group === group);
    if (!wf) return;
    const triggers = wf.steps.filter(s => s.type === 'trigger');
    if (triggers.length === 1) onTrigger(group, triggers[0].id);
    else if (triggers.length > 1) setTriggerPopup({ group, triggers });
    else onTrigger(group);
  }, [workflows, onTrigger]);

  const handleNodeClick = useCallback((idx: number) => {
    // Find which workflow/node this is
    let offset = 0;
    for (const wf of workflows) {
      for (const step of wf.steps) {
        if (offset === idx) {
          onSelectWorkflow(wf.group);
          if (step.type === 'trigger') onTriggerClick(wf.group);
          return;
        }
        offset++;
      }
    }
  }, [workflows, onSelectWorkflow, onTriggerClick]);

  const W = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const H = typeof window !== 'undefined' ? window.innerHeight : 800;

  return (
    <div className="relative flex-1 h-full overflow-hidden"
      style={{ background: theme === 'notion' ? '#f5f5f0' : theme === 'minimal-white' ? '#faf9f8' : theme === 'warm-wood' ? '#f3ecdf' : theme === 'solarized-light' ? '#f6f4e9' : '#0a0a0f', cursor: dragging ? 'grabbing' : 'grab' }}
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onWheel={onWheel}>

      {/* GPU renderer */}
      <FlowGPU width={W} height={H} zoom={zoom} pan={pan} time={time} theme={theme}
        cellNodes={gpuData.cellNodes} cellColors={gpuData.cellColors} cellLabels={gpuData.cellLabels}
        nodeX={gpuData.nodeX} nodeY={gpuData.nodeY} nodeStatus={gpuData.nodeStatus}
        nodeHover={gpuData.nodeHover} nodeLabels={gpuData.nodeLabels}
        edgeX1={gpuData.edgeX1} edgeY1={gpuData.edgeY1} edgeX2={gpuData.edgeX2} edgeY2={gpuData.edgeY2}
        edgeActive={gpuData.edgeActive} />

      {/* Hover tooltip */}
      {hoveredNode && hoverPos && (() => {
        const [g, sid] = hoveredNode.split(':');
        const wf = workflows.find(w => w.group === g);
        const step = wf?.steps.find(s => s.id === sid);
        if (!step) return null;
        const status = runs[g]?.[0]?.steps?.[sid] || 'pending';
        return (
          <div className="fixed z-[100] pointer-events-none" style={{ left: hoverPos.x + 16, top: hoverPos.y - 8 }}>
            <div className={`border rounded-xl px-3 py-2 shadow-xl max-w-[220px] backdrop-blur-sm ${isDark ? 'bg-slate-800/95 border-slate-600/50' : 'bg-white/95 border-gray-200'}`}>
              <div className={`text-[11px] font-medium ${isDark ? 'text-slate-200' : 'text-gray-800'}`}>{step.id}</div>
              {step.agent && <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Agent: {step.agent}</div>}
              {step.prompt && <div className={`text-[9px] mt-1 line-clamp-2 ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>{step.prompt.slice(0, 100)}</div>}
              <div className={`text-[9px] mt-1.5 ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>Space 触发 · 点击详情</div>
            </div>
          </div>
        );
      })()}

      {/* Zoom controls */}
      <div className={`absolute bottom-4 left-4 flex items-center gap-1 backdrop-blur-md rounded-xl border p-1.5 shadow-lg z-10 ${isDark ? 'bg-slate-900/80 border-slate-700/50' : 'bg-white/80 border-gray-200'}`}>
        <button onClick={() => setZoom(z => Math.min(3, z * 1.2))} className={`p-1.5 rounded-lg transition ${isDark ? 'hover:bg-slate-800' : 'hover:bg-gray-100'}`}><ZoomIn size={14} className={isDark ? 'text-slate-400' : 'text-gray-500'} /></button>
        <span className={`text-[10px] w-10 text-center font-mono ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.max(0.15, z / 1.2))} className={`p-1.5 rounded-lg transition ${isDark ? 'hover:bg-slate-800' : 'hover:bg-gray-100'}`}><ZoomOut size={14} className={isDark ? 'text-slate-400' : 'text-gray-500'} /></button>
        <div className={`w-px h-4 mx-0.5 ${isDark ? 'bg-slate-700' : 'bg-gray-200'}`} />
        <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className={`p-1.5 rounded-lg transition ${isDark ? 'hover:bg-slate-800' : 'hover:bg-gray-100'}`}><Maximize2 size={14} className={isDark ? 'text-slate-400' : 'text-gray-500'} /></button>
      </div>

      {/* Trigger popup */}
      {triggerPopup && (
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={() => setTriggerPopup(null)}>
          <div className={`border rounded-2xl p-5 shadow-2xl w-72 ${isDark ? 'bg-slate-900 border-slate-700/50' : 'bg-white border-gray-200'}`} onClick={e => e.stopPropagation()}>
            <h3 className={`text-[13px] font-semibold mb-3 ${isDark ? 'text-slate-200' : 'text-gray-800'}`}>选择触发入口</h3>
            {triggerPopup.triggers.map(t => (
              <button key={t.id} onClick={() => { onTrigger(triggerPopup.group, t.id); setTriggerPopup(null); }}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-[12px] flex items-center gap-2.5 mb-1.5 transition ${isDark ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-gray-100 text-gray-700'}`}>
                {t.id}
                {t.trigger?.cron && <span className="text-[10px] text-slate-500 ml-auto font-mono">{t.trigger.cron}</span>}
              </button>
            ))}
            <button onClick={() => setTriggerPopup(null)} className="w-full mt-3 px-3 py-2 text-[11px] text-slate-500 hover:bg-slate-800 rounded-xl transition">取消</button>
          </div>
        </div>
      )}
    </div>
  );
}
