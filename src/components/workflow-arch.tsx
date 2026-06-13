'use client';

import { useMemo, useRef, useState, useCallback, useEffect } from 'react';

/**
 * Workflow Architecture Diagram — Full Interactive Editor
 *
 * Features:
 * - Click block → right sidebar edit
 * - Right-click → context menu (edit/add/delete/move)
 * - Drag blocks to reposition
 * - Real-time status with animations
 * - Mini-map overview
 * - Orthogonal arrows with rounded corners
 * - Route arrows (conditional jumps)
 */

// ═══════ TYPES ═══════

interface Step {
  id: string;
  agent?: string;
  action?: string;
  prompt?: string;
  dependsOn?: string[];
  routes?: { step: string; when: string }[];
  status?: string;
}

interface Run {
  runId: string;
  status: string;
  steps: Record<string, string>;
  startedAt: number;
  completedAt?: number;
}

interface Props {
  steps: Step[];
  run: Run | null;
  onTrigger?: () => void;
  running?: boolean;
  onStepClick?: (step: Step) => void;
  onStepAdd?: (afterStepId?: string) => void;
  onStepDelete?: (stepId: string) => void;
  onEdgeClick?: (fromId: string, toId: string) => void;
  onEdgeDelete?: (fromId: string, toId: string) => void;
  onEdgeAdd?: (fromId: string, toId: string) => void;
}

// ═══════ CONFIG ═══════

const ACTION_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  create:   { fill: '#dcfce7', stroke: '#16a34a', text: '#14532d' },
  review:   { fill: '#ffedd5', stroke: '#ea580c', text: '#7c2d12' },
  fix:      { fill: '#dbeafe', stroke: '#2563eb', text: '#1e3a5f' },
  verify:   { fill: '#f3e8ff', stroke: '#9333ea', text: '#581c87' },
  deploy:   { fill: '#fce7f3', stroke: '#db2777', text: '#831843' },
  research: { fill: '#ccfbf1', stroke: '#0d9488', text: '#134e4a' },
  execute:  { fill: '#f4f4f5', stroke: '#71717a', text: '#27272a' },
};

const STATUS_COLORS: Record<string, string> = {
  pending:   '#a1a1aa',
  waiting:   '#f59e0b',
  running:   '#3b82f6',
  completed: '#22c55e',
  failed:    '#ef4444',
  blocked:   '#9e9e9e',
  skipped:   '#d4d4d4',
};

const BLOCK_W = 180;
const BLOCK_H = 48;
const GAP_X = 16;
const GAP_Y = 80;
const PAD = 40;
const SVG_W = 480;

// ═══════ HELPERS ═══════

function getColor(action: string) {
  const key = action?.toLowerCase() || '';
  for (const [k, c] of Object.entries(ACTION_COLORS)) {
    if (key.includes(k)) return c;
  }
  return ACTION_COLORS.execute;
}

function buildLayers(steps: Step[]): Step[][] {
  const map = new Map(steps.map(s => [s.id, s]));
  const memo = new Map<string, number>();
  const d = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    const s = map.get(id);
    if (!s?.dependsOn?.length) { memo.set(id, 0); return 0; }
    memo.set(id, Math.max(...s.dependsOn.map(d)) + 1);
    return memo.get(id)!;
  };
  steps.forEach(s => d(s.id));
  const layers = new Map<number, Step[]>();
  for (const s of steps) {
    const k = memo.get(s.id) || 0;
    if (!layers.has(k)) layers.set(k, []);
    layers.get(k)!.push(s);
  }
  return [...layers.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

function orthPath(x1: number, y1: number, x2: number, y2: number, r = 12): string {
  const midY = (y1 + y2) / 2;
  const vDist = Math.abs(midY - y1);
  const hDist = Math.abs(x2 - x1);
  const rc = Math.min(r, vDist * 0.9, hDist * 0.9);
  if (rc < 1) return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
  const vOff = y1 > y2 ? -rc : rc;
  const hOff = x2 > x1 ? rc : -rc;
  return `M ${x1} ${y1} L ${x1} ${midY + vOff} Q ${x1} ${midY} ${x1 + hOff} ${midY} L ${x2 - hOff} ${midY} Q ${x2} ${midY} ${x2} ${midY - vOff} L ${x2} ${y2}`;
}

// ═══════ CSS ANIMATIONS ═══════

const ANIMATIONS = `
  @keyframes wf-pulse { 0%,100% { opacity:1; } 50% { opacity:0.6; } }
  @keyframes wf-blink { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
  @keyframes wf-shake { 0%,100% { transform:translateX(0); } 20%,60% { transform:translateX(-3px); } 40%,80% { transform:translateX(3px); } }
  @keyframes wf-check { 0% { stroke-dashoffset:20; } 100% { stroke-dashoffset:0; } }
  @keyframes wf-dash { to { stroke-dashoffset: -20; } }
  @keyframes wf-slide-in { from { transform:translateX(100%); opacity:0; } to { transform:translateX(0); opacity:1; } }
  @keyframes wf-fade-in { from { opacity:0; transform:scale(0.95); } to { opacity:1; transform:scale(1); } }
  @keyframes wf-float { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-2px); } }
`;

// ═══════ MINI MAP ═══════

function MiniMap({ steps, run, positions, zoom, pan, containerSize }: {
  steps: Step[]; run: Run | null;
  positions: Map<string, { x: number; y: number; w: number; h: number }>;
  zoom: number; pan: { x: number; y: number };
  containerSize: { w: number; h: number };
}) {
  const mapW = 140;
  const mapH = 100;
  const padding = 10;

  // Calculate bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  positions.forEach(p => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  });
  if (!positions.size) { minX = 0; minY = 0; maxX = SVG_W; maxY = 400; }

  const contentW = maxX - minX + 40;
  const contentH = maxY - minY + 40;
  const scale = Math.min((mapW - 10) / contentW, (mapH - 10) / contentH);

  // Viewport rectangle
  const vpW = containerSize.w / zoom;
  const vpH = containerSize.h / zoom;
  const vpX = -pan.x / zoom - minX + 20;
  const vpY = -pan.y / zoom - minY + 20;

  return (
    <div style={{
      position: 'absolute', bottom: 12, right: 12,
      width: mapW, height: mapH,
      background: 'rgba(255,255,255,0.9)', border: '1px solid #e4e4e7',
      borderRadius: 6, overflow: 'hidden', zIndex: 10,
    }}>
      <svg width={mapW} height={mapH}>
        {[...positions.entries()].map(([id, p]) => {
          const step = steps.find(s => s.id === id);
          const c = step ? getColor(step.action || 'execute') : ACTION_COLORS.execute;
          const sx = (p.x - minX + 20) * scale + 5;
          const sy = (p.y - minY + 20) * scale + 5;
          const sw = p.w * scale;
          const sh = p.h * scale;
          return <rect key={id} x={sx} y={sy} width={sw} height={sh} fill={c.fill} stroke={c.stroke} strokeWidth={0.5} rx={1} />;
        })}
        <rect x={vpX * scale + 5} y={vpY * scale + 5} width={vpW * scale} height={vpH * scale}
          fill="none" stroke="#3b82f6" strokeWidth={1.5} rx={1} />
      </svg>
    </div>
  );
}

// ═══════ CONTEXT MENU ═══════

function ContextMenu({ x, y, onClose, onEdit, onAdd, onDelete, onMoveUp, onMoveDown }: {
  x: number; y: number; onClose: () => void;
  onEdit: () => void; onAdd: () => void; onDelete: () => void;
  onMoveUp: () => void; onMoveDown: () => void;
}) {
  const items = [
    { icon: '✏️', label: '编辑', action: onEdit },
    { icon: '➕', label: '添加下一步', action: onAdd },
    { icon: '↑', label: '上移', action: onMoveUp },
    { icon: '↓', label: '下移', action: onMoveDown },
    { icon: '🗑️', label: '删除', action: onDelete, danger: true },
  ];

  return (
    <foreignObject x={x} y={y} width={160} height={200} style={{ overflow: 'visible' } as any}>
      <div style={{
        background: '#fff', border: '1px solid #e4e4e7', borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '4px 0',
        fontFamily: '"Inter", sans-serif', fontSize: 12, color: '#27272a',
        animation: 'wf-fade-in 0.15s ease-out',
      }} onClick={e => e.stopPropagation()}>
        {items.map(item => (
          <div key={item.label}
            style={{
              padding: '7px 12px', cursor: 'pointer',
              color: item.danger ? '#ef4444' : undefined,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#f4f4f5')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            onClick={() => { item.action(); onClose(); }}
          >
            <span style={{ width: 16, textAlign: 'center' }}>{item.icon}</span>
            {item.label}
          </div>
        ))}
      </div>
    </foreignObject>
  );
}

// ═══════ STEP BLOCK ═══════

function StepBlock({
  step, x, y, w, h, status, colors, run,
  onClick, onContextMenu, onDragStart, isDragSource, isSelected,
}: {
  step: Step; x: number; y: number; w: number; h: number;
  status?: string; colors: { fill: string; stroke: string; text: string };
  run: Run | null;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.MouseEvent) => void;
  isDragSource?: boolean;
  isSelected?: boolean;
}) {
  const stepStatus = run?.steps[step.id] || status || 'pending';
  const isRunning = stepStatus === 'in_progress' || stepStatus === 'running';
  const isFailed = stepStatus === 'failed';
  const isCompleted = stepStatus === 'completed';

  // Determine animation
  let animation = 'none';
  if (isRunning) animation = 'wf-pulse 2s ease-in-out infinite';
  else if (isFailed) animation = 'wf-shake 0.4s ease-in-out';
  else if (stepStatus === 'waiting') animation = 'wf-blink 2s ease-in-out infinite';

  const sc = STATUS_COLORS[stepStatus] || colors.stroke;

  return (
    <g
      style={{ cursor: 'pointer', transition: 'transform 0.15s ease, filter 0.15s ease' }}
      onClick={e => { e.stopPropagation(); onClick?.(); }}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onContextMenu?.(e); }}
      onMouseEnter={e => {
        const rect = e.currentTarget.querySelector('rect');
        if (rect) { rect.style.filter = 'drop-shadow(0 4px 8px rgba(0,0,0,0.15))'; rect.style.transform = 'translateY(-2px)'; }
      }}
      onMouseLeave={e => {
        const rect = e.currentTarget.querySelector('rect');
        if (rect) { rect.style.filter = 'none'; rect.style.transform = 'translateY(0)'; }
      }}
    >
      {/* Main block */}
      <rect
        x={x} y={y} width={w} height={h}
        fill={isCompleted ? '#f0fdf4' : isFailed ? '#fef2f2' : colors.fill}
        stroke={isSelected ? '#3b82f6' : sc}
        strokeWidth={isSelected ? 2.5 : 1.5}
        rx={6}
        style={{ transition: 'all 0.3s ease', animation, filter: isDragSource ? 'drop-shadow(0 8px 16px rgba(0,0,0,0.2))' : 'none' }}
      />

      {/* Step ID */}
      <text
        x={x + w / 2} y={y + h / 2 - (isRunning ? 4 : 0)}
        fontSize={13} fontWeight={700}
        fill={colors.text}
        textAnchor="middle" dominantBaseline="middle"
        fontFamily='"JetBrains Mono", monospace'
      >
        {step.id}
      </text>

      {/* Agent name — only when in_progress */}
      {isRunning && step.agent && (
        <text
          x={x + w / 2} y={y + h / 2 + 10}
          fontSize={9} fontWeight={500}
          fill={colors.text} opacity={0.7}
          textAnchor="middle" dominantBaseline="middle"
          fontFamily='"Inter", sans-serif'
        >
          {step.agent}
        </text>
      )}

      {/* Status indicator */}
      <circle cx={x + w - 10} cy={y + 10} r={4} fill={sc} stroke="#fff" strokeWidth={1.5} />

      {/* Completed check */}
      {isCompleted && (
        <path
          d={`M ${x + w - 16} ${y + h - 10} l 4 4 l 8 -8`}
          fill="none" stroke="#22c55e" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          style={{ strokeDasharray: 20, animation: 'wf-check 0.4s ease-out forwards' }}
        />
      )}

      {/* Failed X */}
      {isFailed && (
        <g>
          <line x1={x + w - 18} y1={y + h - 12} x2={x + w - 10} y2={y + h - 4} stroke="#ef4444" strokeWidth={2} strokeLinecap="round" />
          <line x1={x + w - 10} y1={y + h - 12} x2={x + w - 18} y2={y + h - 4} stroke="#ef4444" strokeWidth={2} strokeLinecap="round" />
        </g>
      )}
    </g>
  );
}

// ═══════ EDIT SIDEBAR ═══════

function EditSidebar({ step, mode, onClose, onSave, onDelete }: {
  step: Step | null; mode: 'edit' | 'add';
  onClose: () => void; onSave: (data: any) => void; onDelete?: () => void;
}) {
  const [id, setId] = useState('');
  const [agent, setAgent] = useState('');
  const [action, setAction] = useState('execute');
  const [prompt, setPrompt] = useState('');
  const [dependsOn, setDependsOn] = useState('');

  useEffect(() => {
    if (step && mode === 'edit') {
      setId(step.id); setAgent(step.agent || ''); setAction(step.action || 'execute');
      setPrompt(step.prompt || ''); setDependsOn((step.dependsOn || []).join(', '));
    } else if (mode === 'add') {
      setId(''); setAgent(''); setAction('execute'); setPrompt('');
      setDependsOn(step ? step.id : '');
    }
  }, [step, mode]);

  if (!step && mode === 'edit') return null;

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, width: 320,
      background: '#fff', borderLeft: '1px solid #e4e4e7',
      boxShadow: '-4px 0 16px rgba(0,0,0,0.08)',
      display: 'flex', flexDirection: 'column', zIndex: 20,
      animation: 'wf-slide-in 0.2s ease-out',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e4e4e7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#18181b' }}>
          {mode === 'edit' ? `编辑 · ${step?.id}` : '添加步骤'}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#71717a', padding: 4 }}>×</button>
      </div>

      {/* Form */}
      <div style={{ flex: 1, padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {mode === 'add' && (
          <div>
            <label style={labelStyle}>步骤 ID</label>
            <input value={id} onChange={e => setId(e.target.value)} placeholder="step_id" style={inputStyle} />
          </div>
        )}
        <div>
          <label style={labelStyle}>Agent</label>
          <input value={agent} onChange={e => setAgent(e.target.value)} placeholder="Alice / Bob / Charlie" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Action</label>
          <select value={action} onChange={e => setAction(e.target.value)} style={inputStyle}>
            <option value="create">create</option>
            <option value="review">review</option>
            <option value="fix">fix</option>
            <option value="verify">verify</option>
            <option value="deploy">deploy</option>
            <option value="research">research</option>
            <option value="execute">execute</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Prompt</label>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
            placeholder="任务描述..." rows={4}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }} />
        </div>
        <div>
          <label style={labelStyle}>Depends On</label>
          <input value={dependsOn} onChange={e => setDependsOn(e.target.value)}
            placeholder="step1, step2" style={inputStyle} />
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '16px 20px', borderTop: '1px solid #e4e4e7', display: 'flex', gap: 8 }}>
        {mode === 'edit' && onDelete && (
          <button onClick={() => { onDelete(); onClose(); }}
            style={{ ...btnStyle, background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca' }}>
            删除
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ ...btnStyle, background: '#f4f4f5', color: '#52525b' }}>取消</button>
        <button onClick={() => onSave({ id, agent, action, prompt, dependsOn: dependsOn.split(',').map(s => s.trim()).filter(Boolean) })}
          style={{ ...btnStyle, background: '#18181b', color: '#fff' }}>
          {mode === 'edit' ? '保存' : '添加'}
        </button>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 500, color: '#71717a', marginBottom: 4, display: 'block' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 12, border: '1px solid #e4e4e7', borderRadius: 6, outline: 'none', fontFamily: '"Inter", sans-serif', boxSizing: 'border-box' };
const btnStyle: React.CSSProperties = { padding: '8px 16px', fontSize: 12, fontWeight: 500, border: '1px solid #e4e4e7', borderRadius: 6, cursor: 'pointer', fontFamily: '"Inter", sans-serif' };

// ═══════ MAIN COMPONENT ═══════

export default function WorkflowArch({ steps, run, onStepClick, onStepAdd, onStepDelete, onEdgeClick, onEdgeDelete, onEdgeAdd }: Props) {
  // Inject animations
  useEffect(() => {
    if (!document.getElementById('wf-animations')) {
      const style = document.createElement('style');
      style.id = 'wf-animations';
      style.textContent = ANIMATIONS;
      document.head.appendChild(style);
    }
  }, []);

  const layers = useMemo(() => buildLayers(steps), [steps]);
  const n = layers.length;
  const svgH = n * (BLOCK_H + GAP_Y) + PAD * 2;

  // Positions
  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (let i = 0; i < n; i++) {
      const layer = layers[i];
      const y = PAD + (n - 1 - i) * (BLOCK_H + GAP_Y);
      if (layer.length === 1) {
        pos.set(layer[0].id, { x: (SVG_W - BLOCK_W) / 2, y, w: BLOCK_W, h: BLOCK_H });
      } else {
        const tw = layer.length * BLOCK_W + (layer.length - 1) * GAP_X;
        const ox = (SVG_W - tw) / 2;
        layer.forEach((s, j) => pos.set(s.id, { x: ox + j * (BLOCK_W + GAP_X), y, w: BLOCK_W, h: BLOCK_H }));
      }
    }
    return pos;
  }, [layers, n]);

  // Viewport state
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  const dragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ w: width, h: height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Pan
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) { dragging.current = true; lastMouse.current = { x: e.clientX, y: e.clientY }; }
  }, []);
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    setPan(p => ({ x: p.x + e.clientX - lastMouse.current.x, y: p.y + e.clientY - lastMouse.current.y }));
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onMouseUp = useCallback(() => { dragging.current = false; }, []);

  // Zoom (viewport center)
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(prev => {
      const nz = Math.min(3, Math.max(0.3, prev + delta));
      const s = nz / prev;
      setPan(p => ({ x: cx - (cx - p.x) * s, y: cy - (cy - p.y) * s }));
      return nz;
    });
  }, []);

  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; step: Step } | null>(null);

  // Sidebar
  const [sidebar, setSidebar] = useState<{ mode: 'edit' | 'add'; step: Step | null } | null>(null);

  // Selected block
  const [selected, setSelected] = useState<string | null>(null);

  // Drag to reposition (visual only)
  const [offsets, setOffsets] = useState<Map<string, { dx: number; dy: number }>>(new Map());
  const dragBlock = useRef<{ id: string; startX: number; startY: number } | null>(null);

  const handleBlockDragStart = useCallback((e: React.MouseEvent, stepId: string) => {
    e.stopPropagation();
    dragBlock.current = { id: stepId, startX: e.clientX, startY: e.clientY };
    const handler = (ev: MouseEvent) => {
      if (!dragBlock.current) return;
      const dx = (ev.clientX - dragBlock.current.startX) / zoom;
      const dy = (ev.clientY - dragBlock.current.startY) / zoom;
      setOffsets(prev => {
        const next = new Map(prev);
        const orig = next.get(dragBlock.current!.id) || { dx: 0, dy: 0 };
        next.set(dragBlock.current!.id, { dx: orig.dx + dx, dy: orig.dy + dy });
        return next;
      });
      dragBlock.current.startX = ev.clientX;
      dragBlock.current.startY = ev.clientY;
    };
    const up = () => { dragBlock.current = null; document.removeEventListener('mousemove', handler); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', handler);
    document.addEventListener('mouseup', up);
  }, [zoom]);

  // Get effective position (base + offset)
  const getPos = useCallback((stepId: string) => {
    const base = positions.get(stepId);
    if (!base) return null;
    const off = offsets.get(stepId) || { dx: 0, dy: 0 };
    return { ...base, x: base.x + off.dx, y: base.y + off.dy };
  }, [positions, offsets]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', fontFamily: '"Inter", sans-serif' }}>
      {/* Canvas */}
      <div
        style={{
          width: '100%', height: '100%',
          cursor: dragging.current ? 'grabbing' : 'grab',
          touchAction: 'none', userSelect: 'none',
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onDoubleClick={resetView}
        onClick={() => { setCtxMenu(null); setSelected(null); }}
      >
        <svg
          ref={svgRef}
          width="100%"
          viewBox={`0 0 ${SVG_W} ${svgH}`}
          style={{ display: 'block', transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
        >
          <defs>
            <marker id="arrow" markerWidth={10} markerHeight={7} refX={10} refY={3.5} orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#52525b" />
            </marker>
            <marker id="route-arrow" markerWidth={10} markerHeight={7} refX={10} refY={3.5} orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#f59e0b" />
            </marker>
          </defs>

          {/* Arrows (dependsOn) */}
          {layers.flatMap((layer, li) => {
            if (li >= n - 1) return [];
            const next = layers[li + 1];
            return layer.flatMap(step => {
              const f = getPos(step.id);
              if (!f) return [];
              return next.filter(t => t.dependsOn?.includes(step.id)).map(t => {
                const to = getPos(t.id);
                if (!to) return null;
                const x1 = f.x + f.w / 2, y1 = f.y;
                const x2 = to.x + to.w / 2, y2 = to.y + to.h;
                return (
                  <path key={`${step.id}-${t.id}`}
                    d={orthPath(x1, y1, x2, y2)}
                    fill="none" stroke="#52525b" strokeWidth={1.5}
                    markerEnd="url(#arrow)"
                    style={{ cursor: 'pointer', transition: 'stroke 0.15s' }}
                    onClick={e => { e.stopPropagation(); onEdgeClick?.(step.id, t.id); }}
                    onMouseEnter={e => (e.currentTarget.style.stroke = '#3b82f6')}
                    onMouseLeave={e => (e.currentTarget.style.stroke = '#52525b')}
                  />
                );
              });
            });
          })}

          {/* Route arrows (conditional, dashed + animated) */}
          {(() => {
            let maxRight = 0;
            positions.forEach(p => { maxRight = Math.max(maxRight, p.x + p.w); });
            const outsideX = maxRight + 40;
            return steps.flatMap(step => {
              if (!step.routes?.length) return [];
              const from = getPos(step.id);
              if (!from) return [];
              return step.routes.map(route => {
                const to = getPos(route.step);
                if (!to) return null;
                const x1 = from.x + from.w, y1 = from.y + from.h / 2;
                const x2 = to.x + to.w, y2 = to.y + to.h / 2;
                const r = 16;
                const needDown = y2 > y1;
                const vOff = needDown ? r : -r;
                const path = `M ${x1} ${y1} L ${outsideX - r} ${y1} Q ${outsideX} ${y1} ${outsideX} ${y1 + vOff} L ${outsideX} ${y2 - vOff} Q ${outsideX} ${y2} ${outsideX - r} ${y2} L ${x2} ${y2}`;
                return (
                  <g key={`route-${step.id}-${route.step}`}>
                    <path d={path} fill="none" stroke="#f59e0b" strokeWidth={1.5}
                      strokeDasharray="6,3"
                      style={{ animation: 'wf-dash 1s linear infinite' }}
                      markerEnd="url(#route-arrow)" />
                    <text x={outsideX + 6} y={(y1 + y2) / 2} fontSize={9} fill="#f59e0b"
                      fontFamily='"JetBrains Mono", monospace' dominantBaseline="middle">
                      {route.when}
                    </text>
                  </g>
                );
              });
            });
          })()}

          {/* Blocks */}
          {[...positions.entries()].map(([sid, p]) => {
            const step = steps.find(s => s.id === sid);
            if (!step) return null;
            const off = offsets.get(sid) || { dx: 0, dy: 0 };
            return (
              <StepBlock key={sid} step={step}
                x={p.x + off.dx} y={p.y + off.dy} w={p.w} h={p.h}
                colors={getColor(step.action || 'execute')} run={run}
                isSelected={selected === sid}
                onClick={() => { setSelected(sid); setSidebar({ mode: 'edit', step }); }}
                onContextMenu={e => {
                  const svg = (e.target as SVGElement).closest('svg');
                  if (svg) {
                    const rect = svg.getBoundingClientRect();
                    setCtxMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, step });
                  }
                }}
                onDragStart={e => handleBlockDragStart(e, sid)}
              />
            );
          })}

          {/* Context menu */}
          {ctxMenu && (
            <ContextMenu
              x={ctxMenu.x} y={ctxMenu.y}
              onClose={() => setCtxMenu(null)}
              onEdit={() => { setSidebar({ mode: 'edit', step: ctxMenu.step }); setCtxMenu(null); }}
              onAdd={() => { setSidebar({ mode: 'add', step: ctxMenu.step }); setCtxMenu(null); }}
              onDelete={() => { onStepDelete?.(ctxMenu.step.id); setCtxMenu(null); }}
              onMoveUp={() => setCtxMenu(null)}
              onMoveDown={() => setCtxMenu(null)}
            />
          )}
        </svg>
      </div>

      {/* Mini map */}
      <MiniMap steps={steps} run={run} positions={positions} zoom={zoom} pan={pan} containerSize={containerSize} />

      {/* Edit sidebar */}
      {sidebar && (
        <EditSidebar
          step={sidebar.step} mode={sidebar.mode}
          onClose={() => setSidebar(null)}
          onSave={(data) => {
            if (sidebar.mode === 'edit') {
              // Save edited step
              onStepClick?.({ ...sidebar.step!, ...data });
            } else {
              // Add new step
              onStepAdd?.(sidebar.step?.id);
            }
            setSidebar(null);
          }}
          onDelete={sidebar.mode === 'edit' ? () => onStepDelete?.(sidebar.step!.id) : undefined}
        />
      )}
    </div>
  );
}
