'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';

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
  onStepMove?: (stepId: string, newAgent: string) => void;
}

const C: Record<string, { bg: string; bd: string; tx: string }> = {
  pending:     { bg: '#f3f4f6', bd: '#d1d5db', tx: '#6b7280' },
  in_progress: { bg: '#eff6ff', bd: '#3b82f6', tx: '#1d4ed8' },
  completed:   { bg: '#f0fdf4', bd: '#22c55e', tx: '#15803d' },
  failed:      { bg: '#fef2f2', bd: '#ef4444', tx: '#dc2626' },
  skipped:     { bg: '#f9fafb', bd: '#e5e7eb', tx: '#9ca3af' },
  blocked:     { bg: '#fffbeb', bd: '#f59e0b', tx: '#d97706' },
};

const IC: Record<string, string> = {
  pending: '○', in_progress: '◉', completed: '✓', failed: '✗', skipped: '–', blocked: '◐',
};

export default function WorkflowGantt({ steps, progress, onStepClick, onStepDelete, onStepAdd, onStepMove }: Props) {
  const [hov, setHov] = useState<string | null>(null);
  const [tip, setTip] = useState({ x: 0, y: 0 });
  const [ctx, setCtx] = useState<{ x: number; y: number; s: StepData } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragAgent, setDragAgent] = useState<string | null>(null);
  const [, rerender] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Close context menu on click outside
  useEffect(() => {
    if (!ctx) return;
    const h = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking inside the context menu
      if (target.closest('[data-ctx-menu]')) return;
      setCtx(null);
    };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [ctx]);

  // Right-click: DOM-based context menu (works in all browsers)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.button !== 2) return;
      const target = e.target as HTMLElement;
      const container = boxRef.current;
      if (!container || !container.contains(target)) return;
      if (target.closest('[draggable]')) return;
      e.preventDefault();

      // Remove any existing menu
      const old = document.getElementById('gantt-ctx-menu');
      if (old) old.remove();

      // Find agent from lane
      const laneEl = target.closest('[data-agent]');
      const agent = laneEl?.getAttribute('data-agent') || '';

      // Create context menu
      const menu = document.createElement('div');
      menu.id = 'gantt-ctx-menu';
      menu.style.cssText = `position:fixed;z-index:9999;background:var(--color-canvas);border:1px solid var(--color-border);border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.15);padding:4px;width:140px;left:${Math.min(e.clientX, window.innerWidth - 160)}px;top:${Math.min(e.clientY, window.innerHeight - 120)}px;`;

      const mkBtn = (text: string, cls: string, cb: () => void) => {
        const b = document.createElement('button');
        b.textContent = text;
        b.style.cssText = 'width:100%;text-align:left;padding:6px 12px;font-size:12px;cursor:pointer;border:none;background:transparent;' + cls;
        b.onmouseenter = () => b.style.background = 'var(--color-surface)';
        b.onmouseleave = () => b.style.background = 'transparent';
        b.onclick = (ev) => { ev.stopPropagation(); menu.remove(); cb(); };
        return b;
      };

      menu.appendChild(mkBtn('✎ 编辑', '', () => {
        // Find the closest card to the click position
        const cards = container.querySelectorAll('[draggable]');
        let closestCard: any = null;
        let minDist = Infinity;
        cards.forEach(c => {
          const r = c.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const d = Math.hypot(e.clientX - cx, e.clientY - cy);
          if (d < minDist) { minDist = d; closestCard = c; }
        });
        if (closestCard) {
          const stepId = closestCard.getAttribute('data-step-id') || '';
          const step = steps.find(s => s.id === stepId);
          if (step) onStepClick?.(step);
        }
      }));
      menu.appendChild(mkBtn('+ 添加步骤', '', () => onStepAdd?.({ id: '', agent, action: 'execute', status: 'pending' })));
      if (onStepDelete) {
        menu.appendChild(mkBtn('× 删除', 'color:var(--color-destructive);', () => {}));
      }

      document.body.appendChild(menu);
      // Close on next click
      const close = (ev: MouseEvent) => { if (!menu.contains(ev.target as Node)) { menu.remove(); document.removeEventListener('mousedown', close); } };
      setTimeout(() => document.addEventListener('mousedown', close), 0);
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, []);

  // Callback ref for container
  const boxRefCb = useCallback((el: HTMLDivElement | null) => {
    (boxRef as any).current = el;
  }, []);

  // Empty state
  if (!steps || steps.length === 0) {
    return (
      <div className="bg-surface rounded-xl p-8 text-center">
        <p className="text-[12px] text-muted-foreground">暂无步骤</p>
        {onStepAdd && (
          <button onClick={() => onStepAdd()} className="mt-2 text-[11px] text-primary hover:underline">+ 添加第一个步骤</button>
        )}
      </div>
    );
  }

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

  // Right-click on lane areas — handled via onContextMenu on lane divs

  // Topological layers
  const layers = useMemo(() => {
    const r: string[][] = []; const p = new Set<string>();
    const map = new Map(steps.map(s => [s.id, s]));
    let rest = steps.map(s => s.id);
    while (rest.length > 0) {
      const l: string[] = []; const n: string[] = [];
      for (const id of rest) {
        const d = Array.isArray(map.get(id)?.dependsOn) ? map.get(id)!.dependsOn! : [];
        if (d.every(x => p.has(x)) || d.length === 0) l.push(id); else n.push(id);
      }
      if (l.length === 0) break;
      for (const id of l) p.add(id);
      r.push(l); rest = n;
    }
    return r;
  }, [steps]);

  const LANE_H = 72;
  const LANE_GAP = 2;
  const CARD_H = 44;
  const LABEL_W = 72;
  const totalH = lanes.length * (LANE_H + LANE_GAP) + LANE_GAP;

  // Measure card rects from live DOM
  const measure = (id: string) => {
    const el = refs.current.get(id);
    const box = boxRef.current;
    if (!el || !box) return null;
    const er = el.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    return { l: er.left - br.left, r: er.right - br.left, cy: (er.top + er.height / 2) - br.top };
  };

  // Build edges — use state + useEffect to ensure DOM is ready
  const [edges, setEdges] = useState<Array<{ x1: number; y1: number; x2: number; y2: number }>>([]);

  const calcEdges = useCallback(() => {
    const res: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (const s of steps) {
      const deps = Array.isArray(s.dependsOn) ? s.dependsOn : [];
      for (const d of deps) {
        const src = measure(d);
        const tgt = measure(s.id);
        if (src && tgt) {
          res.push({ x1: src.r, y1: src.cy, x2: tgt.l, y2: tgt.cy });
        }
      }
    }
    setEdges(res);
  }, [steps, measure]);

  // Recalculate edges after every render (DOM update)
  useEffect(() => {
    const raf = requestAnimationFrame(() => calcEdges());
    return () => cancelAnimationFrame(raf);
  }, [calcEdges, rerender]);

  // Drag
  const onDragStart = (e: React.DragEvent, s: StepData) => {
    setDragId(s.id);
    e.dataTransfer.setData('text/plain', s.id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: React.DragEvent, agent: string) => { e.preventDefault(); setDragAgent(agent); };
  const onDrop = (e: React.DragEvent, agent: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id && onStepMove) onStepMove(id, agent);
    setDragId(null); setDragAgent(null);
    requestAnimationFrame(() => rerender(n => n + 1));
  };
  const onDragEnd = () => { setDragId(null); setDragAgent(null); };

  return (
    <div ref={boxRefCb} className="bg-surface rounded-xl w-full overflow-x-auto relative select-none"
      onContextMenu={e => {
        // Only show context menu if right-clicked on empty area (not on a card)
        const target = e.target as HTMLElement;
        if (!target.closest('[draggable]')) {
          e.preventDefault();
          // Find which agent lane was clicked
          const laneEl = target.closest('[data-agent]');
          const agent = laneEl?.getAttribute('data-agent') || lanes[0]?.[0] || '';
          setContextMenu({ x: e.clientX, y: e.clientY, s: { id: '', agent, action: 'execute', status: 'pending' } });
        }
      }}>
      {/* Header */}
      <div className="flex border-b border-border bg-surface-alt h-7">
        <div className="w-[72px] shrink-0 border-r border-border/50 flex items-center justify-center">
          {onStepAdd && (
            <button onClick={() => onStepAdd()} className="text-[10px] text-muted-foreground hover:text-foreground" title="添加步骤">+</button>
          )}
        </div>
        {layers.map((_, i) => (
          <div key={i} className="flex-1 flex items-center justify-center text-[9px] text-muted-foreground border-r border-border/30 last:border-r-0">
            {layers[i].length === 1 ? layers[i][0] : `Phase ${i + 1}`}
          </div>
        ))}
      </div>

      {/* Lanes */}
      {lanes.map(([agent, agentSteps], li) => (
        <div key={agent} data-agent={agent}
          className={`flex border-b border-border/30 ${li % 2 === 0 ? 'bg-surface/30' : ''} ${dragAgent === agent ? 'bg-primary/5 ring-1 ring-primary/30' : ''}`}
          onDragOver={e => onDragOver(e, agent)}
          onDrop={e => onDrop(e, agent)}
          onDragEnd={onDragEnd}
          onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, s: { id: "", agent, action: "execute", status: "pending" } }); }}>
          <div className="w-[72px] shrink-0 flex items-center px-2 text-[9px] font-semibold text-muted border-r border-border/50">{agent}</div>
          <div className="flex-1 flex">
            {layers.map((layer, li) => (
              <div key={li} className="flex-1 flex items-center justify-center gap-1 px-1 py-1.5 border-r border-border/30 last:border-r-0 min-h-[60px]"
                ref={(el) => {
                  if (!el) return;
                  const h = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, s: { id: '', agent, action: 'execute', status: 'pending' } }); };
                  el.oncontextmenu = h;
                }}>
                {agentSteps.filter(s => layer.includes(s.id)).map(s => {
                  const st = s.status || 'pending';
                  const c = C[st] || C.pending;
                  const isHov = hov === s.id;
                  return (
                    <div key={s.id}
                      ref={el => { if (el) refs.current.set(s.id, el); }}
                      className={`rounded-lg px-2 py-1.5 flex flex-col justify-between cursor-grab active:cursor-grabbing transition-all border shrink-0 ${isHov ? 'shadow-md z-10' : 'shadow-sm'} ${dragId === s.id ? 'opacity-40' : ''}`}
                      style={{ backgroundColor: c.bg, borderColor: c.bd, minWidth: 90, maxWidth: 160 }}
                      draggable
                      onDragStart={e => onDragStart(e, s)}
                      onMouseEnter={e => { setHov(s.id); setTip({ x: e.clientX, y: e.clientY }); }}
                      onMouseLeave={() => setHov(null)}
                      onClick={() => onStepClick?.(s)}
                      onContextMenu={e => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, s }); }}>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-foreground truncate max-w-[65%]">{s.id}</span>
                        <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0" style={{ backgroundColor: c.bd, color: '#fff' }}>{IC[st] || '○'}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[8px]" style={{ color: c.tx }}>
                        {s.completedAt && s.startedAt && <span className="bg-white/50 px-1 rounded">{fmt(s.completedAt - s.startedAt)}</span>}
                        {s.reviewer && <span>· review</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Arrows */}
      <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%' }}>
        <defs>
          <marker id="ah" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto">
            <polygon points="0 0, 7 2.5, 0 5" fill="#9ca3af" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const mx = (e.x1 + e.x2) / 2;
          return <path key={i} d={`M${e.x1},${e.y1} C${mx},${e.y1} ${mx},${e.y2} ${e.x2},${e.y2}`} stroke="#9ca3af" strokeWidth="1.5" fill="none" strokeDasharray="5 3" markerEnd="url(#ah)" />;
        })}
      </svg>

      {/* Playhead */}
      <div className="absolute top-0 bottom-0 w-px bg-primary/60 z-30 pointer-events-none" style={{ left: `calc(${LABEL_W}px + ${Math.min(progress, 1) * (100 - 8)}%)` }}>
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-primary" />
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-primary" />
      </div>

      {/* Tooltip */}
      {hov && !ctx && (() => {
        const s = steps.find(x => x.id === hov);
        if (!s) return null;
        const c = C[s.status || 'pending'];
        return (
          <div className="fixed z-50 bg-canvas border border-border rounded-xl shadow-2xl p-3 w-60 pointer-events-none" style={{ left: Math.min(tip.x + 16, window.innerWidth - 260), top: tip.y - 8 }}>
            <div className="flex items-center gap-2 mb-1"><span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold" style={{ backgroundColor: c.bd, color: '#fff' }}>{IC[s.status || 'pending']}</span><span className="text-[12px] font-semibold text-foreground">{s.id}</span></div>
            <div className="space-y-0.5 text-[10px] text-muted-foreground">
              <p>{s.agent} · {s.action}</p>
              {s.completedAt && s.startedAt && <p>耗时: {fmt(s.completedAt - s.startedAt)}</p>}
              {s.reviewer && <p>审查: {s.reviewer}</p>}
              {s.priority && <p>优先级: {s.priority}</p>}
            </div>
          </div>
        );
      })()}

      {/* Context menu — rendered via portal to body */}
      {ctx && typeof document !== 'undefined' && (() => {
        const menu = (
          <div data-ctx-menu className="fixed z-[9999] bg-canvas border border-border rounded-xl shadow-2xl py-1 w-36"
            style={{ left: Math.min(ctx.x, window.innerWidth - 160), top: Math.min(ctx.y, window.innerHeight - 120) }}
            onClick={e => e.stopPropagation()}>
            <button onClick={() => { onStepClick?.(ctx.s); setCtx(null); }} className="w-full text-left px-3 py-1.5 text-[12px] text-foreground hover:bg-surface">✎ 编辑</button>
            <button onClick={() => { onStepAdd?.(ctx.s); setCtx(null); }} className="w-full text-left px-3 py-1.5 text-[12px] text-foreground hover:bg-surface">+ 添加步骤</button>
            {onStepDelete && <button onClick={() => { onStepDelete(ctx.s); setCtx(null); }} className="w-full text-left px-3 py-1.5 text-[12px] text-destructive hover:bg-destructive-muted">× 删除</button>}
          </div>
        );
        return ReactDOM.createPortal(menu, document.body);
      })()}
    </div>
  );
}

function fmt(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}
