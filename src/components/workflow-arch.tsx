'use client';

import { useMemo } from 'react';

/**
 * Workflow Architecture Diagram — Transformer Paper Style
 *
 * Matches "Attention is All You Need" (Vaswani et al., 2017):
 * - Vertical layout (inputs bottom, outputs top)
 * - Large colored blocks filling available width
 * - Semantic colors for different component types
 * - Thick arrows between blocks
 * - Nx notation for repeated layers
 * - Clean academic styling
 */

interface Step {
  id: string;
  agent?: string;
  action?: string;
  prompt?: string;
  dependsOn?: string[];
  reviewer?: string;
  evaluate?: boolean;
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

// Semantic colors — matching Transformer diagram palette
const ACTION_COLORS: Record<string, { fill: string; stroke: string }> = {
  create:  { fill: '#e8f5e9', stroke: '#388e3c' },  // Green — production
  review:  { fill: '#fff3e0', stroke: '#f57c00' },  // Orange — review/audit
  fix:     { fill: '#e3f2fd', stroke: '#1976d2' },  // Blue — revision
  verify:  { fill: '#f3e5f5', stroke: '#7b1fa2' },  // Purple — verification
  deploy:  { fill: '#fce4ec', stroke: '#c2185b' },  // Pink — deployment
  research:{ fill: '#e0f2f1', stroke: '#00796b' },  // Teal — research
  execute: { fill: '#f5f5f5', stroke: '#757575' },  // Gray — default
};

function getActionColor(action: string): { fill: string; stroke: string } {
  for (const [key, colors] of Object.entries(ACTION_COLORS)) {
    if (action.toLowerCase().includes(key)) return colors;
  }
  return ACTION_COLORS.execute;
}

// Build layers from dependency graph (topological sort by depth)
function buildLayers(steps: Step[]): Step[][] {
  const stepMap = new Map(steps.map(s => [s.id, s]));
  const depth = new Map<string, number>();

  function getDepth(id: string): number {
    if (depth.has(id)) depth.get(id)!;
    const step = stepMap.get(id);
    if (!step || !step.dependsOn || step.dependsOn.length === 0) {
      depth.set(id, 0);
      return 0;
    }
    const maxDep = Math.max(...step.dependsOn.map(d => getDepth(d)));
    depth.set(id, maxDep + 1);
    return maxDep + 1;
  }

  steps.forEach(s => getDepth(s.id));

  const layers: Map<number, Step[]> = new Map();
  for (const s of steps) {
    const d = depth.get(s.id) || 0;
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d)!.push(s);
  }

  return Array.from(layers.entries()).sort((a, b) => a[0] - b[0]).map(([, steps]) => steps);
}

export default function WorkflowArch({ steps, run }: Props) {
  const layers = useMemo(() => buildLayers(steps), [steps]);

  // Fixed SVG dimensions — match Transformer diagram proportions exactly
  const svgW = 620;
  const svgH = layers.length * 95 + 70;

  // Calculate block positions — match Transformer proportions exactly
  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
    const blockW = 380; // Transformer blocks are about 380px wide
    const blockH = 60;  // Transformer blocks are about 60px tall
    const gapY = 35;
    const startX = (svgW - blockW) / 2;
    const startY = 30;

    for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
      const layer = layers[layerIdx];
      const y = startY + (layers.length - 1 - layerIdx) * (blockH + gapY);

      if (layer.length === 1) {
        pos.set(layer[0].id, { x: startX, y, w: blockW, h: blockH });
      } else {
        const gap = 12;
        const singleW = (blockW - gap * (layer.length - 1)) / layer.length;
        for (let i = 0; i < layer.length; i++) {
          pos.set(layer[i].id, { x: startX + i * (singleW + gap), y, w: singleW, h: blockH });
        }
      }
    }
    return pos;
  }, [layers]);

  return (
    <div style={{ fontFamily: '"Times New Roman", Times, serif', color: '#000' }}>
      {/* Paper-style caption */}
      <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', textAlign: 'center' }}>
        Figure 1. Workflow Architecture
      </div>

      {/* SVG Diagram — fills container */}
      <svg width="100%" viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: 'block' }}>
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#333" />
          </marker>
        </defs>

        {/* Arrows between blocks */}
        {layers.map((layer, layerIdx) => {
          if (layerIdx >= layers.length - 1) return null;
          const nextLayer = layers[layerIdx + 1];

          return layer.map(step => {
            const from = positions.get(step.id);
            if (!from) return null;

            const targets = nextLayer.filter(s => s.dependsOn?.includes(step.id));
            return targets.map(target => {
              const to = positions.get(target.id);
              if (!to) return null;

              const x1 = from.x + from.w / 2;
              const y1 = from.y;
              const x2 = to.x + to.w / 2;
              const y2 = to.y + to.h;

              return (
                <line key={`${step.id}-${target.id}`}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="#333" strokeWidth="2.5" markerEnd="url(#arrowhead)" />
              );
            });
          });
        })}

        {/* Step blocks — large, filling width */}
        {Array.from(positions.entries()).map(([stepId, pos]) => {
          const step = steps.find(s => s.id === stepId);
          if (!step) return null;
          const colors = getActionColor(step.action || 'execute');

          return (
            <g key={stepId}>
              <rect x={pos.x} y={pos.y} width={pos.w} height={pos.h}
                fill={colors.fill} stroke={colors.stroke} strokeWidth="2" rx="4" />
              <text x={pos.x + pos.w / 2} y={pos.y + 25} fontSize="14" fontWeight="bold" fill="#333" textAnchor="middle" fontFamily="monospace">
                {step.id}
              </text>
              <text x={pos.x + pos.w / 2} y={pos.y + 42} fontSize="11" fill="#555" textAnchor="middle" fontFamily="monospace">
                {step.agent || '?'} · {step.action || 'execute'}
              </text>
            </g>
          );
        })}

        {/* Nx notation */}
        {layers.length > 1 && (
          <text x={svgW - 20} y={svgH / 2} fontSize="16" fill="#666" fontFamily="serif">
            ×{layers.length}
          </text>
        )}

        {/* Skip connections — like Transformer diagram */}
        {layers.length > 1 && layers[0].map(step => {
          const from = positions.get(step.id);
          if (!from) return null;
          const lastLayer = layers[layers.length - 1];
          const targets = lastLayer.filter(s => s.dependsOn?.includes(step.id));
          return targets.map(target => {
            const to = positions.get(target.id);
            if (!to) return null;
            const skipX = from.x - 15;
            return (
              <g key={`skip-${step.id}-${target.id}`}>
                <line x1={skipX} y1={from.y + from.h / 2} x2={skipX} y2={to.y + to.h / 2}
                  stroke="#333" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
              </g>
            );
          });
        })}

        {/* Inputs label */}
        <text x={svgW / 2} y={svgH - 10} fontSize="12" fill="#333" textAnchor="middle" fontFamily="serif">
          Inputs
        </text>

        {/* Output label */}
        <text x={svgW / 2} y={20} fontSize="12" fill="#333" textAnchor="middle" fontFamily="serif">
          Output
        </text>
      </svg>

      {/* Caption */}
      <div style={{ fontSize: '10px', color: '#555', textAlign: 'center', marginTop: '8px', fontFamily: '"Times New Roman", serif' }}>
        <strong>Fig. 1.</strong> {steps.length}-module workflow with {layers.length} dependency layers.
        {' '}Color indicates component type (green=production, orange=review, blue=revision).
      </div>
    </div>
  );
}
