'use client';

import { useMemo } from 'react';

/**
 * Workflow Architecture Diagram — NLP Paper Style
 *
 * Like "Attention is All You Need" (Vaswani et al., 2017):
 * - Vertical layout, inputs bottom → outputs top
 * - Colored blocks for each module
 * - Curved arrows + skip connections
 * - Status indicators (colored dots)
 * - ×N notation for repeated layers
 * - Easy to edit: change CONFIG, ACTION_COLORS, or STATUS_COLORS below
 */

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

/* ═══════════════════════════════════════════════════
 * EDIT THESE to change appearance
 * ═══════════════════════════════════════════════════ */

// Action type → block colors
const ACTION_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  create:   { fill: '#e8f5e9', stroke: '#388e3c', text: '#1b5e20' },
  review:   { fill: '#fff3e0', stroke: '#f57c00', text: '#e65100' },
  fix:      { fill: '#e3f2fd', stroke: '#1976d2', text: '#0d47a1' },
  verify:   { fill: '#f3e5f5', stroke: '#7b1fa2', text: '#4a148c' },
  deploy:   { fill: '#fce4ec', stroke: '#c2185b', text: '#880e4f' },
  research: { fill: '#e0f2f1', stroke: '#00796b', text: '#004d40' },
  execute:  { fill: '#f5f5f5', stroke: '#757575', text: '#212121' },
};

// Step status → indicator dot color
const STATUS_COLORS: Record<string, string> = {
  pending:   '#9e9e9e',
  waiting:   '#ff9800',
  running:   '#2196f3',
  completed: '#4caf50',
  failed:    '#f44336',
};

// Layout constants
const W = 420;            // SVG width
const BLOCK_W = 180;      // Block width
const BLOCK_H = 44;       // Block height
const GAP_X = 10;         // Gap between blocks in same layer
const GAP_Y = 70;         // Gap between layers
const PAD = 30;           // Padding
const ARROW_COLOR = '#333';

function getColor(action: string) {
  const key = action?.toLowerCase() || '';
  for (const [k, c] of Object.entries(ACTION_COLORS)) {
    if (key.includes(k)) return c;
  }
  return ACTION_COLORS.execute;
}

function buildLayers(steps: Step[]): Step[][] {
  const map = new Map(steps.map(s => [s.id, s]));
  const depth = new Map<string, number>();
  const d = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    const s = map.get(id);
    if (!s?.dependsOn?.length) { depth.set(id, 0); return 0; }
    const mx = Math.max(...s.dependsOn.map(d));
    depth.set(id, mx + 1);
    return mx + 1;
  };
  steps.forEach(s => d(s.id));
  const layers = new Map<number, Step[]>();
  for (const s of steps) {
    const k = depth.get(s.id) || 0;
    if (!layers.has(k)) layers.set(k, []);
    layers.get(k)!.push(s);
  }
  return [...layers.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

export default function WorkflowArch({ steps, run }: Props) {
  const layers = useMemo(() => buildLayers(steps), [steps]);
  const n = layers.length;
  const svgH = n * (BLOCK_H + GAP_Y) + PAD * 2;

  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (let i = 0; i < n; i++) {
      const layer = layers[i];
      const y = PAD + (n - 1 - i) * (BLOCK_H + GAP_Y);
      if (layer.length === 1) {
        pos.set(layer[0].id, { x: (W - BLOCK_W) / 2, y, w: BLOCK_W, h: BLOCK_H });
      } else {
        const tw = layer.length * BLOCK_W + (layer.length - 1) * GAP_X;
        const ox = (W - tw) / 2;
        layer.forEach((s, j) => {
          pos.set(s.id, { x: ox + j * (BLOCK_W + GAP_X), y, w: BLOCK_W, h: BLOCK_H });
        });
      }
    }
    return pos;
  }, [layers, n]);

  return (
    <div style={{ fontFamily: '"Times New Roman", Times, serif', color: '#000' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: 10, textAlign: 'center' }}>
        Figure 1. Workflow Architecture
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${svgH}`} style={{ display: 'block' }}>
        <defs>
          <marker id="ah" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill={ARROW_COLOR} />
          </marker>
        </defs>

        {/* Arrows */}
        {layers.flatMap((layer, li) => {
          if (li >= n - 1) return [];
          const next = layers[li + 1];
          return layer.flatMap(step => {
            const f = positions.get(step.id);
            if (!f) return [];
            return next.filter(t => t.dependsOn?.includes(step.id)).map(t => {
              const to = positions.get(t.id);
              if (!to) return null;
              const x1 = f.x + f.w / 2, y1 = f.y;
              const x2 = to.x + to.w / 2, y2 = to.y + to.h;
              const my = (y1 + y2) / 2;
              return (
                <path key={`${step.id}-${t.id}`}
                  d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`}
                  fill="none" stroke={ARROW_COLOR} strokeWidth="1.5" markerEnd="url(#ah)" />
              );
            });
          });
        })}

        {/* Blocks */}
        {[...positions.entries()].map(([sid, p]) => {
          const step = steps.find(s => s.id === sid);
          if (!step) return null;
          const c = getColor(step.action || 'execute');
          const sc = run?.steps[sid] ? STATUS_COLORS[run.steps[sid]] : undefined;
          return (
            <g key={sid}>
              <rect x={p.x} y={p.y} width={p.w} height={p.h}
                fill={c.fill} stroke={c.stroke} strokeWidth="1.5" rx="3" />
              {sc && (
                <circle cx={p.x + p.w - 10} cy={p.y + 10} r="5"
                  fill={sc} stroke="#fff" strokeWidth="1" />
              )}
              <text x={p.x + p.w / 2} y={p.y + p.h / 2 - 5}
                fontSize="11" fontWeight="bold" fill={c.text}
                textAnchor="middle" fontFamily="monospace">
                {step.id}
              </text>
              <text x={p.x + p.w / 2} y={p.y + p.h / 2 + 9}
                fontSize="9" fill={c.text} opacity="0.75"
                textAnchor="middle" fontFamily="monospace">
                {step.agent || '?'} · {step.action || 'execute'}
              </text>
            </g>
          );
        })}

        {/* ×N */}
        {n > 1 && (
          <text x={W - 15} y={svgH / 2} fontSize="14" fill="#666"
            fontFamily="serif" textAnchor="middle" dominantBaseline="middle">
            ×{n}
          </text>
        )}

        {/* Inputs / Output */}
        <text x={W / 2} y={svgH - 8} fontSize="11" fill="#333" textAnchor="middle" fontFamily="serif">
          Inputs
        </text>
        <text x={W / 2} y={18} fontSize="11" fill="#333" textAnchor="middle" fontFamily="serif">
          Output
        </text>
      </svg>

      <div style={{ fontSize: '10px', color: '#555', textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>
        <strong>Fig. 1.</strong> {steps.length}-module workflow, {n} dependency layers.
        Color = component type (green=production, orange=review, blue=revision, purple=verification).
        {run && <> Status: <span style={{ color: STATUS_COLORS[run.status] || '#333', fontWeight: 600 }}>{run.status}</span>.</>}
      </div>
    </div>
  );
}
