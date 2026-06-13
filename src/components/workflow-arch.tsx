'use client';

import { useMemo } from 'react';

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

/** Render a single block — the main visual element */
function Block({
  step, x, y, w, h, status, colors,
}: {
  step: Step; x: number; y: number; w: number; h: number;
  status?: string; colors: { fill: string; stroke: string; text: string };
}) {
  const sc = status ? STATUS_COLORS[status] : undefined;

  return (
    <g>
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
    </g>
  );
}

/** Render a curved arrow between two blocks */
function Arrow({
  fx, fy, fw, fh, tx, ty, tw, th, id,
}: {
  fx: number; fy: number; fw: number; fh: number;
  tx: number; ty: number; tw: number; th: number;
  id: string;
}) {
  const x1 = fx + fw / 2;
  const y1 = fy;
  const x2 = tx + tw / 2;
  const y2 = ty + th;
  const my = (y1 + y2) / 2;

  return (
    <path
      key={`arrow-${id}`}
      d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`}
      fill="none"
      stroke={STYLE.arrowColor}
      strokeWidth={STYLE.arrowWidth}
      markerEnd="url(#arrow)"
    />
  );
}

/* ═══════════════════════════════════════════════════════════════
 * §4. MAIN COMPONENT
 * ═══════════════════════════════════════════════════════════════ */

export default function WorkflowArch({ steps, run }: Props) {
  const layers = useMemo(() => buildLayers(steps), [steps]);
  const n = layers.length;

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

      <svg
        width="100%"
        viewBox={`0 0 ${W} ${svgH}`}
        style={{ display: 'block', overflow: 'visible' }}
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
                  />
                );
              });
          });
        })}

        {/* Skip connections (dashed, for long-range dependencies) */}
        {layers.flatMap((layer, li) => {
          if (li < n - 2) return []; // only first-to-last or non-adjacent
          return [];
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
            />
          );
        })}

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
        {' '}Color = component type
        {' '}(<span style={{ color: '#16a34a' }}>green</span>=production,
        {' '}<span style={{ color: '#ea580c' }}>orange</span>=review,
        {' '}<span style={{ color: '#2563eb' }}>blue</span>=revision,
        {' '}<span style={{ color: '#9333ea' }}>purple</span>=verification).
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
