'use client';
import { useMemo } from 'react';
import { X, Play, Clock, CheckCircle, XCircle, Loader, ArrowRight } from 'lucide-react';

interface WorkflowStep {
  id: string; type?: string; agent?: string; action?: string; prompt?: string;
  dependsOn?: string[]; routes?: { step: string; when: string }[];
  reviewer?: string; priority?: string; trigger?: any;
}

interface RunInfo {
  runId: string; status: string; steps: Record<string, string>;
  startedAt: number; completedAt?: number;
}

interface FlowPanelProps {
  workflow: { group: string; name: string; description?: string; steps: WorkflowStep[] } | null;
  run: RunInfo | null;
  onClose: () => void;
  onTrigger: (group: string, triggerStepId?: string) => void;
}

// ── Build tree from DAG ──

interface TreeNode {
  step: WorkflowStep;
  children: TreeNode[];
  status: string;
  routes?: { step: string; when: string }[];
}

function buildTree(steps: WorkflowStep[], statuses: Record<string, string>): TreeNode[] {
  const stepMap = new Map(steps.map(s => [s.id, s]));
  const childrenMap = new Map<string, string[]>();

  for (const s of steps) {
    for (const dep of s.dependsOn || []) {
      if (!childrenMap.has(dep)) childrenMap.set(dep, []);
      childrenMap.get(dep)!.push(s.id);
    }
  }

  // Find roots (no dependencies or trigger nodes)
  const roots = steps.filter(s => !s.dependsOn?.length || s.type === 'trigger');

  function buildNode(stepId: string): TreeNode {
    const step = stepMap.get(stepId)!;
    const childIds = childrenMap.get(stepId) || [];
    return {
      step,
      children: childIds.map(id => buildNode(id)),
      status: statuses[stepId] || 'pending',
      routes: step.routes,
    };
  }

  // Deduplicate roots (a step might be both a root and a child)
  const rootIds = new Set(roots.map(r => r.id));
  for (const childIds of childrenMap.values()) {
    for (const cid of childIds) rootIds.delete(cid);
  }

  return [...rootIds].map(id => buildNode(id));
}

// ── Status config ──

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; color: string; bg: string }> = {
  pending:     { icon: Clock,        color: 'text-muted-foreground', bg: 'bg-muted/20' },
  waiting:     { icon: Clock,        color: 'text-yellow-500',      bg: 'bg-yellow-500/10' },
  in_progress: { icon: Loader,       color: 'text-blue-500',        bg: 'bg-blue-500/10' },
  completed:   { icon: CheckCircle,  color: 'text-green-500',       bg: 'bg-green-500/10' },
  failed:      { icon: XCircle,      color: 'text-red-500',         bg: 'bg-red-500/10' },
  skipped:     { icon: Clock,        color: 'text-muted-foreground', bg: 'bg-muted/10' },
};

const STEP_ICONS: Record<string, string> = {
  trigger: '⚡', test: '🧪', build: '📦', deploy: '🚀', review: '🔍',
  fix: '🔧', verify: '✅', notify: '📢', research: '📚', synthesize: '📝',
  present: '📊', done: '🏁', human_approval: '👤', default: '📋',
};

function getIcon(step: WorkflowStep): string {
  if (step.type === 'trigger') return '⚡';
  const action = (step.action || '').toLowerCase();
  for (const [key, icon] of Object.entries(STEP_ICONS)) {
    if (action.includes(key)) return icon;
  }
  return STEP_ICONS.default;
}

function formatTime(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── Tree Node Component ──

function TreeNodeComponent({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const cfg = STATUS_CONFIG[node.status] || STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  const icon = getIcon(node.step);
  const isRunning = node.status === 'in_progress' || node.status === 'waiting';

  return (
    <div className="relative">
      {/* Connector line */}
      {depth > 0 && (
        <div className="absolute left-[-16px] top-0 w-4 h-5 border-l-2 border-b-2 border-border rounded-bl-lg" />
      )}

      {/* Node card */}
      <div className={`relative rounded-xl border p-3 mb-2 ${cfg.bg} ${isRunning ? 'border-blue-500/50 shadow-[0_0_12px_rgba(59,130,246,0.15)]' : 'border-border'}`}
        style={{ marginLeft: depth * 24 }}>
        <div className="flex items-center gap-2">
          <span className="text-[14px]">{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-medium text-foreground truncate">{node.step.id}</span>
              {node.step.agent && <span className="text-[10px] text-muted-foreground">· {node.step.agent}</span>}
            </div>
            {node.step.prompt && (
              <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{node.step.prompt.slice(0, 80)}</p>
            )}
          </div>
          <Icon size={14} className={cfg.color} />
        </div>

        {/* Routes */}
        {node.routes && node.routes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {node.routes.map((r, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md bg-surface border border-border text-muted-foreground">
                <ArrowRight size={8} /> {r.when} → {r.step}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Children */}
      {node.children.length > 0 && (
        <div className="relative pl-4">
          {node.children.map(child => (
            <TreeNodeComponent key={child.step.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Panel ──

export default function FlowPanel({ workflow, run, onClose, onTrigger }: FlowPanelProps) {
  const tree = useMemo(() => {
    if (!workflow) return [];
    return buildTree(workflow.steps, run?.steps || {});
  }, [workflow, run]);

  if (!workflow) return null;

  const stepsTotal = workflow.steps.filter(s => s.type !== 'trigger').length;
  const stepsDone = run ? Object.values(run.steps).filter(s => s === 'completed' || s === 'skipped').length : 0;
  const progress = stepsTotal > 0 ? stepsDone / stepsTotal : 0;

  return (
    <div className="w-[320px] h-full bg-surface border-l border-border flex flex-col shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[14px] font-semibold text-foreground">{workflow.name}</h2>
          <button onClick={onClose} className="p-1 hover:bg-surface-alt rounded-lg"><X size={14} className="text-muted" /></button>
        </div>
        <p className="text-[11px] text-muted-foreground">{workflow.description || `#${workflow.group}`}</p>

        {/* Progress bar */}
        {run && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>{run.status === 'completed' ? '✅ 完成' : run.status === 'failed' ? '❌ 失败' : '🔄 运行中'}</span>
              <span>{stepsDone}/{stepsTotal}</span>
            </div>
            <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-500 to-green-500 rounded-full transition-all duration-500" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        )}

        {/* Trigger button */}
        {!run && (
          <button onClick={() => onTrigger(workflow.group)}
            className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-foreground text-canvas text-[11px] font-medium rounded-xl hover:opacity-90">
            <Play size={12} /> 触发
          </button>
        )}
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="text-[10px] text-muted-foreground font-medium mb-2">步骤结构</div>
        {tree.map(node => (
          <TreeNodeComponent key={node.step.id} node={node} />
        ))}
      </div>

      {/* Run info */}
      {run && (
        <div className="p-4 border-t border-border">
          <div className="text-[10px] text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span>Run ID</span>
              <span className="font-mono text-foreground">{run.runId.slice(0, 8)}</span>
            </div>
            <div className="flex justify-between">
              <span>开始</span>
              <span className="text-foreground">{new Date(run.startedAt).toLocaleTimeString()}</span>
            </div>
            {run.completedAt && (
              <div className="flex justify-between">
                <span>耗时</span>
                <span className="text-foreground">{formatTime(run.completedAt - run.startedAt)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
