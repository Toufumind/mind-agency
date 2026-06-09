'use client';

import { useState, useEffect, useMemo } from 'react';
import { Play, Loader2, CheckCircle, XCircle, Clock, AlertTriangle, ChevronRight } from 'lucide-react';

/**
 * Workflow Architecture Diagram — NLP Paper Style
 *
 * Clean rectangular blocks, arrows with data flow labels,
 * monospace fonts, minimal color. Like Transformer architecture diagrams.
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

// Status colors — minimal palette
const STATUS: Record<string, { bg: string; border: string; text: string; dot: string; label: string }> = {
  pending:     { bg: 'bg-white',      border: 'border-gray-300',  text: 'text-gray-500',  dot: 'bg-gray-300',  label: 'PENDING' },
  waiting:     { bg: 'bg-amber-50',   border: 'border-amber-300', text: 'text-amber-600', dot: 'bg-amber-400', label: 'WAITING' },
  in_progress: { bg: 'bg-blue-50',    border: 'border-blue-300',  text: 'text-blue-600',  dot: 'bg-blue-400',  label: 'RUNNING' },
  completed:   { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-600', dot: 'bg-emerald-400', label: 'DONE' },
  failed:      { bg: 'bg-red-50',     border: 'border-red-300',   text: 'text-red-600',   dot: 'bg-red-400',   label: 'FAILED' },
  skipped:     { bg: 'bg-gray-50',    border: 'border-gray-200',  text: 'text-gray-400',  dot: 'bg-gray-300',  label: 'SKIP' },
};

function getStatus(step: Step, run: Run | null): string {
  if (!run) return 'pending';
  return run.steps[step.id] || 'pending';
}

// Build layers from dependency graph (topological sort by depth)
function buildLayers(steps: Step[]): Step[][] {
  const stepMap = new Map(steps.map(s => [s.id, s]));
  const depth = new Map<string, number>();

  function getDepth(id: string): number {
    if (depth.has(id)) return depth.get(id)!;
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

export default function WorkflowArch({ steps, run, onTrigger, running }: Props) {
  const layers = useMemo(() => buildLayers(steps), [steps]);
  const [selectedStep, setSelectedStep] = useState<string | null>(null);

  const selected = steps.find(s => s.id === selectedStep);

  return (
    <div className="font-mono">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[14px] font-semibold text-gray-900 tracking-tight" style={{ fontFamily: 'Georgia, serif' }}>
            Architecture
          </h2>
          <p className="text-[11px] text-gray-400 mt-0.5">{steps.length} modules · {layers.length} layers</p>
        </div>
        {onTrigger && (
          <button onClick={onTrigger} disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 transition-colors">
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {running ? 'Running...' : 'Execute'}
          </button>
        )}
      </div>

      {/* Architecture diagram */}
      <div className="relative">
        {layers.map((layer, layerIdx) => (
          <div key={layerIdx} className="mb-2">
            {/* Layer label */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[9px] text-gray-400 uppercase tracking-widest w-12 shrink-0">L{layerIdx}</span>
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-[9px] text-gray-400">{layer.length} module{layer.length > 1 ? 's' : ''}</span>
            </div>

            {/* Step blocks */}
            <div className="flex gap-3 pl-14">
              {layer.map(step => {
                const st = getStatus(step, run);
                const cfg = STATUS[st];
                const isSelected = selectedStep === step.id;
                return (
                  <div key={step.id} className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedStep(isSelected ? null : step.id)}
                      className={`relative border-2 rounded px-3 py-2 text-left transition-all min-w-[140px] ${cfg.bg} ${cfg.border} ${isSelected ? 'ring-2 ring-gray-300 shadow-sm' : 'hover:shadow-sm'}`}>
                      {/* Status dot */}
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        <span className={`text-[9px] font-bold tracking-wider ${cfg.text}`}>{cfg.label}</span>
                      </div>
                      {/* Step ID */}
                      <p className="text-[12px] font-semibold text-gray-900 truncate">{step.id}</p>
                      {/* Agent + Action */}
                      <div className="flex items-center gap-1 mt-1">
                        {step.agent && <span className="text-[10px] text-gray-500">{step.agent}</span>}
                        {step.action && <span className="text-[9px] text-gray-400">· {step.action}</span>}
                      </div>
                      {/* Reviewer badge */}
                      {step.reviewer && (
                        <div className="absolute -top-1.5 -right-1.5 text-[8px] bg-violet-100 text-violet-600 border border-violet-200 rounded px-1 py-0.5 font-medium">
                          → {step.reviewer}
                        </div>
                      )}
                      {/* Evaluate badge */}
                      {step.evaluate && (
                        <div className="absolute -top-1.5 left-2 text-[8px] bg-blue-100 text-blue-600 border border-blue-200 rounded px-1 py-0.5 font-medium">
                          eval
                        </div>
                      )}
                    </button>
                    {/* Arrow to next layer */}
                    {layerIdx < layers.length - 1 && (
                      <div className="flex flex-col items-center mx-1">
                        <ChevronRight size={14} className="text-gray-300" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Dependency arrows between layers */}
            {layerIdx < layers.length - 1 && (
              <div className="pl-14 mt-1 mb-1">
                <svg width="100%" height="20" className="overflow-visible">
                  {layer.map((step, i) => {
                    const nextLayer = layers[layerIdx + 1] || [];
                    const nextSteps = nextLayer.filter(s => s.dependsOn?.includes(step.id));
                    return nextSteps.map((ns, j) => {
                      const x1 = (i / layer.length) * 100 + (50 / layer.length);
                      const x2 = (nextLayer.indexOf(ns) / nextLayer.length) * 100 + (50 / nextLayer.length);
                      return (
                        <line key={`${step.id}-${ns.id}`}
                          x1={`${x1}%`} y1="0" x2={`${x2}%`} y2="20"
                          stroke="#d1d5db" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
                      );
                    });
                  })}
                  <defs>
                    <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                      <polygon points="0 0, 8 3, 0 6" fill="#d1d5db" />
                    </marker>
                  </defs>
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Selected step detail */}
      {selected && (
        <div className="mt-6 border-2 border-gray-200 rounded-lg p-4 bg-gray-50/50">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-bold text-gray-900">{selected.id}</span>
            <span className="text-[10px] text-gray-400">·</span>
            <span className="text-[10px] text-gray-500">{selected.agent}</span>
            <span className="text-[10px] text-gray-400">·</span>
            <span className="text-[10px] text-gray-500">{selected.action}</span>
          </div>
          {selected.prompt && (
            <p className="text-[11px] text-gray-600 leading-relaxed border-l-2 border-gray-300 pl-3">
              {selected.prompt}
            </p>
          )}
          <div className="flex gap-4 mt-3 text-[10px] text-gray-400">
            {selected.dependsOn?.length ? <span>← depends: {selected.dependsOn.join(', ')}</span> : null}
            {selected.reviewer && <span>→ reviewer: {selected.reviewer}</span>}
            {selected.evaluate && <span>★ evaluated</span>}
            {selected.routes?.length && <span>⟁ {selected.routes.length} route(s)</span>}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-6 flex items-center gap-4 text-[9px] text-gray-400 border-t border-gray-200 pt-3">
        <span className="uppercase tracking-wider font-medium">Legend:</span>
        {Object.entries(STATUS).map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-sm ${cfg.dot}`} />
            <span>{cfg.label}</span>
          </div>
        ))}
        <span className="ml-auto">→ dependency</span>
      </div>
    </div>
  );
}
