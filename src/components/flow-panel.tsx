'use client';
import { useMemo } from 'react';
import { X, Play, Clock, CheckCircle, XCircle, Loader, ArrowRight, Zap } from 'lucide-react';

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

// ── Build tree ──

interface TreeNode { step: WorkflowStep; children: TreeNode[]; status: string; routes?: { step: string; when: string }[]; }

function buildTree(steps: WorkflowStep[], statuses: Record<string, string>): TreeNode[] {
  const stepMap = new Map(steps.map(s => [s.id, s]));
  const childrenMap = new Map<string, string[]>();
  for (const s of steps) {
    for (const dep of s.dependsOn || []) {
      if (!childrenMap.has(dep)) childrenMap.set(dep, []);
      childrenMap.get(dep)!.push(s.id);
    }
  }
  const roots = steps.filter(s => !s.dependsOn?.length || s.type === 'trigger');
  const rootIds = new Set(roots.map(r => r.id));
  for (const childIds of childrenMap.values()) for (const cid of childIds) rootIds.delete(cid);

  function build(id: string): TreeNode {
    const step = stepMap.get(id)!;
    return { step, children: (childrenMap.get(id) || []).map(build), status: statuses[id] || 'pending', routes: step.routes };
  }
  return [...rootIds].map(build);
}

const STATUS_CFG: Record<string, { icon: typeof CheckCircle; color: string; bg: string; label: string }> = {
  pending:     { icon: Clock,       color: 'text-slate-500',    bg: 'bg-slate-800/50',   label: '等待' },
  waiting:     { icon: Clock,       color: 'text-yellow-400',   bg: 'bg-yellow-500/10',  label: '等待中' },
  in_progress: { icon: Loader,      color: 'text-blue-400',     bg: 'bg-blue-500/10',    label: '进行中' },
  completed:   { icon: CheckCircle, color: 'text-green-400',    bg: 'bg-green-500/10',   label: '完成' },
  failed:      { icon: XCircle,     color: 'text-red-400',      bg: 'bg-red-500/10',     label: '失败' },
  skipped:     { icon: Clock,       color: 'text-slate-600',    bg: 'bg-slate-800/30',   label: '跳过' },
};

const ICONS: Record<string, string> = { trigger: '⚡', test: '🧪', build: '📦', deploy: '🚀', review: '🔍', fix: '🔧', verify: '✅', notify: '📢', research: '📚', synthesize: '📝', present: '📊', done: '🏁', human_approval: '👤', default: '📋' };
function getIcon(s: WorkflowStep): string { if (s.type === 'trigger') return '⚡'; const a = (s.action || '').toLowerCase(); for (const [k, v] of Object.entries(ICONS)) if (a.includes(k)) return v; return ICONS.default; }
function fmtTime(ms: number): string { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; }

// ── Tree node ──

function TreeNodeView({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const cfg = STATUS_CFG[node.status] || STATUS_CFG.pending;
  const Icon = cfg.icon;
  const icon = getIcon(node.step);
  const isActive = node.status === 'in_progress' || node.status === 'waiting';

  return (
    <div className="relative">
      {depth > 0 && <div className="absolute left-[-14px] top-0 w-3.5 h-5 border-l-2 border-b-2 border-slate-700 rounded-bl-lg" />}
      <div className={`relative rounded-xl border p-3 mb-1.5 transition-all ${cfg.bg} ${isActive ? 'border-blue-500/40 shadow-[0_0_16px_rgba(59,130,246,0.1)]' : 'border-slate-700/50'}`}
        style={{ marginLeft: depth * 22 }}>
        <div className="flex items-center gap-2">
          <span className="text-[13px]">{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-medium text-slate-200 truncate">{node.step.id}</span>
              {node.step.agent && <span className="text-[10px] text-slate-500">· {node.step.agent}</span>}
            </div>
            {node.step.prompt && <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">{node.step.prompt.slice(0, 60)}</p>}
          </div>
          <div className="flex items-center gap-1">
            <Icon size={12} className={cfg.color} />
            <span className={`text-[9px] ${cfg.color}`}>{cfg.label}</span>
          </div>
        </div>
        {node.routes && node.routes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {node.routes.map((r, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md bg-slate-800 border border-slate-700/50 text-slate-400">
                <ArrowRight size={7} /> {r.when} → {r.step}
              </span>
            ))}
          </div>
        )}
      </div>
      {node.children.length > 0 && (
        <div className="pl-3.5">{node.children.map(c => <TreeNodeView key={c.step.id} node={c} depth={depth + 1} />)}</div>
      )}
    </div>
  );
}

// ── Panel ──

export default function FlowPanel({ workflow, run, onClose, onTrigger }: FlowPanelProps) {
  const tree = useMemo(() => workflow ? buildTree(workflow.steps, run?.steps || {}) : [], [workflow, run]);
  if (!workflow) return null;

  const total = workflow.steps.filter(s => s.type !== 'trigger').length;
  const done = run ? Object.values(run.steps).filter(s => s === 'completed' || s === 'skipped').length : 0;
  const progress = total > 0 ? done / total : 0;

  return (
    <div className="w-[340px] h-full bg-slate-900/95 backdrop-blur-md border-l border-slate-700/50 flex flex-col shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-slate-700/50">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-violet-400" />
            <h2 className="text-[14px] font-semibold text-slate-100">{workflow.name}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-lg transition"><X size={14} className="text-slate-500" /></button>
        </div>
        <p className="text-[11px] text-slate-500">{workflow.description || `#${workflow.group}`}</p>

        {run && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1.5">
              <span className={run.status === 'completed' ? 'text-green-400' : run.status === 'failed' ? 'text-red-400' : 'text-blue-400'}>
                {run.status === 'completed' ? '✅ 完成' : run.status === 'failed' ? '❌ 失败' : '🔄 运行中'}
              </span>
              <span className="font-mono">{done}/{total}</span>
            </div>
            <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${progress * 100}%`, background: run.status === 'failed' ? 'linear-gradient(90deg, #ef4444, #f97316)' : 'linear-gradient(90deg, #3b82f6, #22c55e)' }} />
            </div>
          </div>
        )}

        {!run && (
          <button onClick={() => onTrigger(workflow.group)}
            className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-[11px] font-medium rounded-xl hover:bg-blue-500 transition shadow-lg shadow-blue-500/20">
            <Play size={12} /> 触发运行
          </button>
        )}
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        <div className="text-[10px] text-slate-600 font-medium mb-3 uppercase tracking-wider">步骤结构</div>
        {tree.map(node => <TreeNodeView key={node.step.id} node={node} />)}
      </div>

      {/* Run info */}
      {run && (
        <div className="p-4 border-t border-slate-700/50 space-y-1.5">
          <div className="flex justify-between text-[10px]"><span className="text-slate-500">Run</span><span className="text-slate-400 font-mono">{run.runId.slice(0, 8)}</span></div>
          <div className="flex justify-between text-[10px]"><span className="text-slate-500">开始</span><span className="text-slate-400">{new Date(run.startedAt).toLocaleTimeString()}</span></div>
          {run.completedAt && <div className="flex justify-between text-[10px]"><span className="text-slate-500">耗时</span><span className="text-slate-400">{fmtTime(run.completedAt - run.startedAt)}</span></div>}
        </div>
      )}
    </div>
  );
}
