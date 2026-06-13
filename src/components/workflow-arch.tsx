'use client';

import { useMemo, useRef, useState, useCallback, useEffect } from 'react';

/**
 * Workflow Architecture Diagram — Transformer Paper Style
 *
 * Inspired by "Attention is All You Need" (Vaswani et al., 2017)
 * and modern NLP architecture diagrams.
 *
 * EDITING GUIDE:
 * ─────────────
 * 1. ACTION_COLORS  — change block colors per action type
 * 2. STATUS_COLORS  — change status indicator colors
 * 3. STYLE object   — adjust spacing, fonts, arrow appearance
 * 4. renderBlock()  — customize individual block appearance
 * 5. renderArrow()  — customize arrow style (curved, straight, dashed)
 */

/* ═══════════════════════════════════════════════════════════════
 * §1. CONFIGURATION — Edit these to customize appearance
 * ═══════════════════════════════════════════════════════════════ */

interface Step {
  id: string;
  agent?: string;
  action?: string;
  prompt?: string;
  dependsOn?: string[];
  routes?: { step: string; when: string }[];
  status?: string;
  reviewer?: string;
  priority?: string;
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
  onEdgeClick?: (fromId: string, toId: string) => void;      // Click arrow to edit dependency
  onEdgeDelete?: (fromId: string, toId: string) => void;     // Delete dependency
  onEdgeAdd?: (fromId: string, toId: string) => void;        // Drag to create dependency
}

// ── Block Colors (action type → fill/stroke/text) ──
const ACTION_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  create:   { fill: '#dcfce7', stroke: '#16a34a', text: '#14532d' },  // Green
  review:   { fill: '#ffedd5', stroke: '#ea580c', text: '#7c2d12' },  // Orange
  fix:      { fill: '#dbeafe', stroke: '#2563eb', text: '#1e3a5f' },  // Blue
  verify:   { fill: '#f3e8ff', stroke: '#9333ea', text: '#581c87' },  // Purple
  deploy:   { fill: '#fce7f3', stroke: '#db2777', text: '#831843' },  // Pink
  research: { fill: '#ccfbf1', stroke: '#0d9488', text: '#134e4a' },  // Teal
  execute:  { fill: '#f4f4f5', stroke: '#71717a', text: '#27272a' },  // Gray
};

// ── Status Colors ──
const STATUS_COLORS: Record<string, string> = {
  pending:   '#a1a1aa',
  waiting:   '#f59e0b',
  running:   '#3b82f6',
  completed: '#22c55e',
  failed:    '#ef4444',
};

// ── Layout & Style ──
const STYLE = {
  // SVG canvas
  svgWidth: 480,
  padding: 40,

  // Block dimensions
  blockWidth: 200,
  blockHeight: 52,
  blockRadius: 6,

  // Gaps
  gapX: 16,         // horizontal gap between blocks in same layer
  gapY: 90,         // vertical gap between layers

  // Arrows
  arrowColor: '#52525b',
  arrowWidth: 1.8,
  arrowHead: { w: 10, h: 8 },

  // Fonts
  titleFont: '"EB Garamond", "Times New Roman", Georgia, serif',
  bodyFont: '"Inter", "Helvetica Neue", Arial, sans-serif',
  monoFont: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',

  // Status dot
  dotRadius: 5,
  dotStroke: 2,
};

/* ═══════════════════════════════════════════════════════════════
 * §2. HELPERS — Don't edit unless you know what you're doing
 * ═══════════════════════════════════════════════════════════════ */

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

  const depth = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    const s = map.get(id);
    if (!s?.dependsOn?.length) { memo.set(id, 0); return 0; }
    const mx = Math.max(...s.dependsOn.map(depth));
    memo.set(id, mx + 1);
    return mx + 1;
  };

  steps.forEach(s => depth(s.id));

  const layers = new Map<number, Step[]>();
  for (const s of steps) {
    const k = memo.get(s.id) || 0;
    if (!layers.has(k)) layers.set(k, []);
    layers.get(k)!.push(s);
  }

  return [...layers.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}

/* ═══════════════════════════════════════════════════════════════
 * §3. RENDERERS — Customize individual visual elements
 * ═══════════════════════════════════════════════════════════════ */

/** Context menu for right-click on a block */
function BlockContextMenu({
  x, y, stepId, onClose, onEdit, onDelete, onAddAfter,
}: {
  x: number; y: number; stepId: string; onClose: () => void;
  onEdit: () => void; onDelete: () => void; onAddAfter: () => void;
}) {
  const menuStyle: React.CSSProperties = {
    background: '#fff', border: '1px solid #e4e4e7', borderRadius: 8,
    boxShadow: '0 4px 12px rgba(0,0,0,0.12)', padding: '4px 0',
    fontFamily: STYLE.bodyFont, fontSize: 12, color: '#27272a',
    position: 'relative', zIndex: 100,
  };

  return (
    <foreignObject x={x} y={y} width={160} height={120} style={{ overflow: 'visible' } as any}>
      <div style={menuStyle} onClick={e => e.stopPropagation()}>

        <div
          style={{ padding: '6px 12px', cursor: 'pointer' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#f4f4f5')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          onClick={() => { onEdit(); onClose(); }}
        >
          ✏️ 编辑
        </div>
        <div
          style={{ padding: '6px 12px', cursor: 'pointer' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#f4f4f5')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          onClick={() => { onAddAfter(); onClose(); }}
        >
          ➕ 添加步骤
        </div>
        <div
          style={{ padding: '6px 12px', cursor: 'pointer', color: '#ef4444' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          onClick={() => { onDelete(); onClose(); }}
        >
          🗑️ 删除
        </div>
      </div>
    </foreignObject>
  );
}

/** Render a single block — the main visual element */
function Block({
  step, x, y, w, h, status, colors,
  onContextMenu, onClick, onAddClick, onDragStart, onDragEnd, isDragSource,
}: {
  step: Step; x: number; y: number; w: number; h: number;
  status?: string; colors: { fill: string; stroke: string; text: string };
  onContextMenu?: (e: React.MouseEvent, stepId: string) => void;
  onClick?: (step: Step) => void;
  onAddClick?: (afterStepId: string) => void;
  onDragStart?: (e: React.MouseEvent, stepId: string) => void;
  onDragEnd?: (e: React.MouseEvent, stepId: string) => void;
  isDragSource?: boolean;
}) {
  const sc = status ? STATUS_COLORS[status] : undefined;

  return (
    <g style={{ cursor: 'pointer' }}
      onClick={e => { e.stopPropagation(); onClick?.(step); }}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onContextMenu?.(e, step.id); }}
    >
      {/* Shadow */}
      <rect
        x={x + 2} y={y + 3} width={w} height={h}
        fill="rgba(0,0,0,0.08)" rx={STYLE.blockRadius}
      />

      {/* Main block */}
      <rect
        x={x} y={y} width={w} height={h}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth={1.5}
        rx={STYLE.blockRadius}
      />

      {/* Inner highlight (top edge) */}
      <rect
        x={x + 1} y={y + 1} width={w - 2} height={2}
        fill="rgba(255,255,255,0.6)" rx={2}
      />

      {/* Step ID — bold, large */}
      <text
        x={x + w / 2} y={y + h / 2 - 6}
        fontSize={13} fontWeight={700}
        fill={colors.text}
        textAnchor="middle" dominantBaseline="middle"
        fontFamily={STYLE.monoFont}
      >
        {step.id}
      </text>

      {/* Agent · Action — smaller, muted */}
      <text
        x={x + w / 2} y={y + h / 2 + 10}
        fontSize={10} fontWeight={500}
        fill={colors.text} opacity={0.7}
        textAnchor="middle" dominantBaseline="middle"
        fontFamily={STYLE.bodyFont}
      >
        {step.agent || 'agent'} · {step.action || 'execute'}
      </text>

      {/* Status indicator dot */}
      {sc && (
        <g>
          <circle cx={x + w - 12} cy={y + 12} r={STYLE.dotRadius + 1} fill="#fff" />
          <circle cx={x + w - 12} cy={y + 12} r={STYLE.dotRadius} fill={sc} />
        </g>
      )}

      {/* Add button — bottom-right corner */}
      {onAddClick && (
        <g
          onClick={e => { e.stopPropagation(); onAddClick(step.id); }}
          style={{ cursor: 'pointer' }}
        >
          <circle cx={x + w + 2} cy={y + h / 2} r={8} fill="#fafafa" stroke="#d4d4d8" strokeWidth={1} />
          <text x={x + w + 2} y={y + h / 2} fontSize={11} fill="#71717a"
            textAnchor="middle" dominantBaseline="middle" fontWeight={500}>+</text>
        </g>
      )}

      {/* Drag handle — bottom edge, for creating new dependencies */}
      {onDragStart && (
        <g
          onMouseDown={e => { e.stopPropagation(); onDragStart(e, step.id); }}
          style={{ cursor: 'grab' }}
        >
          <circle cx={x + w / 2} cy={y + h + 2} r={6}
            fill={isDragSource ? '#3b82f6' : '#fafafa'}
            stroke={isDragSource ? '#3b82f6' : '#d4d4d8'}
            strokeWidth={1.5} />
          <text x={x + w / 2} y={y + h + 2} fontSize={8} fill={isDragSource ? '#fff' : '#71717a'}
            textAnchor="middle" dominantBaseline="middle">⋮</text>
        </g>
      )}
    </g>
  );
}

/** Generate orthogonal path with rounded corners */
function orthPath(x1: number, y1: number, x2: number, y2: number, r = 8): string {
  // Simple L-shape with rounded corner: down then right (or right then down)
  const midY = (y1 + y2) / 2;
  // Clamp radius
  const rClamp = Math.min(r, Math.abs(midY - y1) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - midY) / 2);
  if (rClamp < 1) return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
  return `M ${x1} ${y1} L ${x1} ${midY - rClamp} Q ${x1} ${midY} ${x1 + (x2 > x1 ? rClamp : -rClamp)} ${midY} L ${x2 - (x2 > x1 ? rClamp : -rClamp)} ${midY} Q ${x2} ${midY} ${x2} ${midY + rClamp} L ${x2} ${y2}`;
}

/** Render an orthogonal arrow between two blocks — clickable */
function Arrow({
  fx, fy, fw, fh, tx, ty, tw, th, id, fromId, toId,
  onClick, onContextMenu, hovered, dragSource,
}: {
  fx: number; fy: number; fw: number; fh: number;
  tx: number; ty: number; tw: number; th: number;
  id: string; fromId: string; toId: string;
  onClick?: (fromId: string, toId: string) => void;
  onContextMenu?: (e: React.MouseEvent, fromId: string, toId: string) => void;
  hovered?: boolean;
  dragSource?: string;
}) {
  const x1 = fx + fw / 2;
  const y1 = fy;
  const x2 = tx + tw / 2;
  const y2 = ty + th;
  const path = orthPath(x1, y1, x2, y2);

  // Thicker invisible hit area for easier clicking
  return (
    <g key={`arrow-${id}`}>
      {/* Hit area (invisible, wider) */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ cursor: 'pointer' }}
        onClick={e => { e.stopPropagation(); onClick?.(fromId, toId); }}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onContextMenu?.(e, fromId, toId); }}
      />
      {/* Visible arrow */}
      <path
        d={path}
        fill="none"
        stroke={hovered ? '#3b82f6' : dragSource === fromId ? '#22c55e' : STYLE.arrowColor}
        strokeWidth={hovered ? 2.5 : STYLE.arrowWidth}
        markerEnd="url(#arrow)"
        style={{ pointerEvents: 'none', transition: 'stroke 0.15s, stroke-width 0.15s' }}
      />
    </g>
  );
}

/* ═══════════════════════════════════════════════════════════════
 * §4. MAIN COMPONENT
 * ═══════════════════════════════════════════════════════════════ */

export default function WorkflowArch({ steps, run, onStepClick, onStepAdd, onStepDelete, onEdgeClick, onEdgeDelete, onEdgeAdd }: Props) {
  const layers = useMemo(() => buildLayers(steps), [steps]);
  const n = layers.length;

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; stepId: string } | null>(null);

  // Edge context menu
  const [edgeCtx, setEdgeCtx] = useState<{ x: number; y: number; fromId: string; toId: string } | null>(null);

  // Drag-to-connect state
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [dragMouse, setDragMouse] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Close menus on outside click
  useEffect(() => {
    if (!ctxMenu && !edgeCtx) return;
    const close = () => { setCtxMenu(null); setEdgeCtx(null); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [ctxMenu, edgeCtx]);

  // Get SVG-local mouse coords
  const getSvgCoords = (e: React.MouseEvent | MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    // Account for pan/zoom transform
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Start drag from block's right edge
  const onBlockDragStart = (e: React.MouseEvent, stepId: string) => {
    e.stopPropagation();
    setDragSource(stepId);
    setDragMouse(getSvgCoords(e));
  };

  const onBlockDragMove = (e: React.MouseEvent) => {
    if (!dragSource) return;
    setDragMouse(getSvgCoords(e));
  };

  const onBlockDragEnd = (e: React.MouseEvent, targetId: string) => {
    if (dragSource && dragSource !== targetId) {
      onEdgeAdd?.(dragSource, targetId);
    }
    setDragSource(null);
    setDragMouse(null);
  };

  const cancelDrag = () => { setDragSource(null); setDragMouse(null); };

  const W = STYLE.svgWidth;
  const { blockWidth: BW, blockHeight: BH, gapX: GX, gapY: GY, padding: PAD } = STYLE;
  const svgH = n * (BH + GY) + PAD * 2;

  // Calculate positions for each block
  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (let i = 0; i < n; i++) {
      const layer = layers[i];
      const y = PAD + (n - 1 - i) * (BH + GY);
      if (layer.length === 1) {
        pos.set(layer[0].id, { x: (W - BW) / 2, y, w: BW, h: BH });
      } else {
        const totalW = layer.length * BW + (layer.length - 1) * GX;
        const ox = (W - totalW) / 2;
        layer.forEach((s, j) => {
          pos.set(s.id, { x: ox + j * (BW + GX), y, w: BW, h: BH });
        });
      }
    }
    return pos;
  }, [layers, n, W, BH, GY, GX, BW]);

  // ── Pan & Zoom state ──
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  // Mouse down → start dragging
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start drag on middle-click or shift+left-click (avoid text selection)
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      dragging.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    } else if (e.button === 0) {
      // Left click also starts drag for SVG canvas
      dragging.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const onMouseUp = useCallback(() => {
    dragging.current = false;
  }, []);

  // Wheel → zoom
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(prev => Math.min(3, Math.max(0.3, prev + delta)));
  }, []);

  // Double-click → reset
  const onDoubleClick = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Touch support for mobile
  const touchRef = useRef<{ dist: number; mid: { x: number; y: number } } | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      dragging.current = true;
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchRef.current = {
        dist: Math.sqrt(dx * dx + dy * dy),
        mid: {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        },
      };
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1 && dragging.current) {
      const dx = e.touches[0].clientX - lastMouse.current.x;
      const dy = e.touches[0].clientY - lastMouse.current.y;
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    } else if (e.touches.length === 2 && touchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scale = dist / touchRef.current.dist;
      setZoom(prev => Math.min(3, Math.max(0.3, prev * scale)));
      touchRef.current.dist = dist;
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    dragging.current = false;
    touchRef.current = null;
  }, []);

  // Reset controls
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => setZoom(prev => Math.min(3, prev + 0.2)), []);
  const zoomOut = useCallback(() => setZoom(prev => Math.max(0.3, prev - 0.2)), []);

  return (
    <div style={{
      fontFamily: STYLE.bodyFont,
      color: '#18181b',
      width: '100%',
      maxWidth: W,
      margin: '0 auto',
    }}>
      {/* Title */}
      <div style={{
        fontFamily: STYLE.titleFont,
        fontSize: 15,
        fontWeight: 600,
        marginBottom: 14,
        textAlign: 'center',
        letterSpacing: '0.3px',
        color: '#27272a',
      }}>
        Figure 1. Workflow Architecture
      </div>

      {/* Zoom controls */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', gap: 4,
        marginBottom: 6, marginRight: 4,
      }}>
        <button onClick={zoomIn}
          style={{ width: 26, height: 26, fontSize: 14, border: '1px solid #d4d4d8', borderRadius: 4, background: '#fafafa', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="Zoom in">+</button>
        <button onClick={zoomOut}
          style={{ width: 26, height: 26, fontSize: 14, border: '1px solid #d4d4d8', borderRadius: 4, background: '#fafafa', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="Zoom out">−</button>
        <button onClick={resetView}
          style={{ height: 26, fontSize: 10, border: '1px solid #d4d4d8', borderRadius: 4, background: '#fafafa', cursor: 'pointer', padding: '0 6px', fontFamily: STYLE.monoFont }}
          title="Reset view (double-click canvas)">Reset</button>
        <span style={{ fontSize: 10, color: '#a1a1aa', alignSelf: 'center', marginLeft: 4, fontFamily: STYLE.monoFont }}>
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {/* Canvas */}
      <div
        style={{
          overflow: 'hidden',
          border: '1px solid #e4e4e7',
          borderRadius: 8,
          background: '#fafafa',
          cursor: dragging.current ? 'grabbing' : 'grab',
          touchAction: 'none',
          userSelect: 'none',
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <svg
          ref={svgRef}
          width="100%"
          viewBox={`0 0 ${W} ${svgH}`}
          style={{
            display: 'block',
            overflow: 'visible',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          <defs>
            {/* Arrow marker */}
            <marker
              id="arrow"
              markerWidth={STYLE.arrowHead.w}
              markerHeight={STYLE.arrowHead.h}
              refX={STYLE.arrowHead.w}
              refY={STYLE.arrowHead.h / 2}
              orient="auto"
            >
              <polygon
                points={`0 0, ${STYLE.arrowHead.w} ${STYLE.arrowHead.h / 2}, 0 ${STYLE.arrowHead.h}`}
                fill={STYLE.arrowColor}
              />
            </marker>

            {/* Route arrow marker (amber, for conditional jumps) */}
            <marker
              id="route-arrow"
              markerWidth={10}
              markerHeight={7}
              refX={10}
              refY={3.5}
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#f59e0b" />
            </marker>

            {/* Gradient for background */}
            <linearGradient id="bg-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fafafa" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#f5f5f5" stopOpacity="0.3" />
            </linearGradient>
          </defs>

          {/* Subtle background */}
          <rect
            x={PAD / 2} y={PAD / 2}
            width={W - PAD} height={svgH - PAD}
            fill="url(#bg-grad)"
            rx={8}
            stroke="#e4e4e7"
            strokeWidth={0.5}
          />

          {/* Arrows between adjacent layers */}
          {layers.flatMap((layer, li) => {
            if (li >= n - 1) return [];
            const next = layers[li + 1];
            return layer.flatMap(step => {
              const f = positions.get(step.id);
              if (!f) return [];
              return next
                .filter(t => t.dependsOn?.includes(step.id))
                .map(t => {
                  const to = positions.get(t.id);
                  if (!to) return null;
                  return (
                    <Arrow
                      key={`${step.id}-${t.id}`}
                      fx={f.x} fy={f.y} fw={f.w} fh={f.h}
                      tx={to.x} ty={to.y} tw={to.w} th={to.h}
                      id={`${step.id}-${t.id}`}
                      fromId={step.id} toId={t.id}
                      onClick={(from, to) => onEdgeClick?.(from, to)}
                      onContextMenu={(e, from, to) => {
                        const svg = (e.target as SVGElement).closest('svg');
                        if (svg) {
                          const rect = svg.getBoundingClientRect();
                          setEdgeCtx({
                            x: e.clientX - rect.left,
                            y: e.clientY - rect.top,
                            fromId: from, toId: to,
                          });
                        }
                      }}
                    />
                  );
                });
            });
          })}

          {/* Route arrows (conditional jumps, dashed) */}
          {steps.flatMap(step => {
            if (!step.routes?.length) return [];
            const from = positions.get(step.id);
            if (!from) return [];
            return step.routes.map(route => {
              const to = positions.get(route.step);
              if (!to) return null;
              // Route: from right edge, go right, curve back to target's right edge
              const x1 = from.x + from.w;
              const y1 = from.y + from.h / 2;
              const x2 = to.x + to.w;
              const y2 = to.y + to.h / 2;
              const midX = Math.max(x1, x2) + 35;
              const r = 10;
              // Orthogonal path: right → down → left (loop back)
              const path = `M ${x1} ${y1} L ${midX - r} ${y1} Q ${midX} ${y1} ${midX} ${y1 + (y2 > y1 ? r : -r)} L ${midX} ${y2 - (y2 > y1 ? r : -r)} Q ${midX} ${y2} ${midX - r} ${y2} L ${x2} ${y2}`;
              return (
                <g key={`route-${step.id}-${route.step}`}>
                  <path
                    d={path}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                    strokeDasharray="6,3"
                    markerEnd="url(#route-arrow)"
                  />
                  <text
                    x={midX + 4}
                    y={(y1 + y2) / 2}
                    fontSize={8}
                    fill="#f59e0b"
                    fontFamily={STYLE.monoFont}
                    dominantBaseline="middle"
                  >
                    {route.when}
                  </text>
                </g>
              );
            });
          })}

          {/* Step blocks */}
          {[...positions.entries()].map(([sid, p]) => {
            const step = steps.find(s => s.id === sid);
            if (!step) return null;
            return (
              <Block
                key={sid}
                step={step}
                x={p.x} y={p.y} w={p.w} h={p.h}
                status={run?.steps[sid]}
                colors={getColor(step.action || 'execute')}
                onClick={onStepClick ? (s) => onStepClick(s) : undefined}
                onAddClick={onStepAdd ? (afterId) => onStepAdd(afterId) : undefined}
                onDragStart={onEdgeAdd ? onBlockDragStart : undefined}
                onDragEnd={onBlockDragEnd}
                isDragSource={dragSource === sid}
                onContextMenu={(e, stepId) => {
                  const svg = (e.target as SVGElement).closest('svg');
                  if (svg) {
                    const rect = svg.getBoundingClientRect();
                    setCtxMenu({
                      x: e.clientX - rect.left,
                      y: e.clientY - rect.top,
                      stepId,
                    });
                  }
                }}
              />
            );
          })}

          {/* Context menu */}
          {ctxMenu && (
            <BlockContextMenu
              x={ctxMenu.x} y={ctxMenu.y}
              stepId={ctxMenu.stepId}
              onClose={() => setCtxMenu(null)}
              onEdit={() => {
                const step = steps.find(s => s.id === ctxMenu.stepId);
                if (step) onStepClick?.(step);
              }}
              onDelete={() => onStepDelete?.(ctxMenu.stepId)}
              onAddAfter={() => onStepAdd?.(ctxMenu.stepId)}
            />
          )}

          {/* Edge context menu */}
          {edgeCtx && (
            <foreignObject x={edgeCtx.x} y={edgeCtx.y} width={160} height={80} style={{ overflow: 'visible' } as any}>
              <div style={{
                background: '#fff', border: '1px solid #e4e4e7', borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)', padding: '4px 0',
                fontFamily: STYLE.bodyFont, fontSize: 12, color: '#27272a',
              }} onClick={e => e.stopPropagation()}>
                <div style={{ padding: '6px 12px', color: '#71717a', fontSize: 10, fontFamily: STYLE.monoFont }}>
                  {edgeCtx.fromId} → {edgeCtx.toId}
                </div>
                <div
                  style={{ padding: '6px 12px', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f4f4f5')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => { onEdgeClick?.(edgeCtx.fromId, edgeCtx.toId); setEdgeCtx(null); }}
                >
                  ✏️ 编辑依赖
                </div>
                <div
                  style={{ padding: '6px 12px', cursor: 'pointer', color: '#ef4444' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => { onEdgeDelete?.(edgeCtx.fromId, edgeCtx.toId); setEdgeCtx(null); }}
                >
                  🗑️ 删除连线
                </div>
              </div>
            </foreignObject>
          )}

          {/* Drag line preview */}
          {dragSource && dragMouse && (() => {
            const from = positions.get(dragSource);
            if (!from) return null;
            const x1 = from.x + from.w / 2;
            const y1 = from.y + from.h;
            const x2 = dragMouse.x;
            const y2 = dragMouse.y;
            const r = 8;
            const midY = (y1 + y2) / 2;
            const rC = Math.min(r, Math.abs(midY - y1) / 2, Math.abs(x2 - x1) / 2);
            const path = rC < 1
              ? `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`
              : `M ${x1} ${y1} L ${x1} ${midY - rC} Q ${x1} ${midY} ${x1 + (x2 > x1 ? rC : -rC)} ${midY} L ${x2 - (x2 > x1 ? rC : -rC)} ${midY} Q ${x2} ${midY} ${x2} ${midY + rC} L ${x2} ${y2}`;
            return (
              <path
                d={path}
                fill="none" stroke="#3b82f6" strokeWidth={2}
                strokeDasharray="6,3" opacity={0.7}
                style={{ pointerEvents: 'none' }}
              />
            );
          })()}

          {/* ×N notation */}
          {n > 1 && (
            <text
              x={W - PAD / 2 + 12}
              y={svgH / 2}
              fontSize={16} fontWeight={600}
              fill="#71717a"
              fontFamily={STYLE.titleFont}
              fontStyle="italic"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              ×{n}
            </text>
          )}

          {/* Inputs / Output labels */}
          <text
            x={W / 2} y={svgH - PAD / 2 + 16}
            fontSize={12} fontWeight={500}
            fill="#52525b"
            textAnchor="middle"
            fontFamily={STYLE.titleFont}
            fontStyle="italic"
          >
            Inputs
          </text>
          <text
            x={W / 2} y={PAD / 2 - 8}
            fontSize={12} fontWeight={500}
            fill="#52525b"
            textAnchor="middle"
            fontFamily={STYLE.titleFont}
            fontStyle="italic"
          >
            Output
          </text>
        </svg>
      </div>

      {/* Figure caption */}
      <div style={{
        fontSize: 11,
        color: '#71717a',
        textAlign: 'center',
        marginTop: 12,
        lineHeight: 1.6,
        fontFamily: STYLE.titleFont,
      }}>
        <strong>Fig. 1.</strong>{' '}
        {steps.length}-module workflow, {n} dependency layers.
        {' '}Drag to pan · Scroll to zoom · Double-click to reset.
        {run && (
          <>
            {' '}Status:{' '}
            <span style={{
              color: STATUS_COLORS[run.status] || '#333',
              fontWeight: 600,
            }}>
              {run.status}
            </span>.
          </>
        )}
      </div>
    </div>
  );
}
