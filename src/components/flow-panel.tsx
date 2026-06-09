'use client';
import { useMemo, useState, useEffect } from 'react';
import { useTheme } from '@/lib/theme';
import { X, Play, Clock, CheckCircle, XCircle, Loader, Zap, ChevronDown, ChevronRight, RotateCw, AlertTriangle } from 'lucide-react';

// ── Types ──
interface WorkflowStep { id: string; type?: string; agent?: string; action?: string; prompt?: string; dependsOn?: string[]; routes?: { step: string; when: string }[]; reviewer?: string; priority?: string; trigger?: any; }
interface RunInfo { runId: string; status: string; steps: Record<string, string>; startedAt: number; completedAt?: number; }
interface FlowPanelProps { workflow: { group: string; name: string; description?: string; steps: WorkflowStep[] } | null; run: RunInfo | null; onClose: () => void; onTrigger: (g: string, triggerStepId?: string) => void; onRefresh?: () => void; }

// ── Tree ──
interface TreeNode { step: WorkflowStep; children: TreeNode[]; status: string; }

function buildTree(steps: WorkflowStep[], statuses: Record<string, string>): TreeNode[] {
  const stepMap = new Map(steps.map(s => [s.id, s]));
  const childrenMap = new Map<string, string[]>();
  for (const s of steps) { for (const dep of s.dependsOn || []) { if (!childrenMap.has(dep)) childrenMap.set(dep, []); childrenMap.get(dep)!.push(s.id); } }
  const allTargets = new Set<string>();
  for (const s of steps) for (const dep of s.dependsOn || []) allTargets.add(dep);
  const rootIds = steps.filter(s => !allTargets.has(s.id) || s.type === 'trigger').map(s => s.id);
  const visited = new Set<string>();
  function build(id: string): TreeNode | null {
    if (visited.has(id)) return null;
    visited.add(id);
    const step = stepMap.get(id);
    if (!step) return null;
    return { step, children: (childrenMap.get(id) || []).map(build).filter(Boolean) as TreeNode[], status: statuses[id] || 'pending' };
  }
  return rootIds.map(build).filter(Boolean) as TreeNode[];
}

// ── Status config ──
const ST: Record<string, { icon: typeof CheckCircle; color: string; bg: string; label: string; dot: string }> = {
  pending:     { icon: Clock,       color: 'text-gray-400',    bg: 'bg-gray-50',   label: '等待',   dot: 'bg-gray-300' },
  waiting:     { icon: Clock,       color: 'text-amber-500',   bg: 'bg-amber-50',  label: '等待中', dot: 'bg-amber-400' },
  in_progress: { icon: Loader,      color: 'text-blue-500',    bg: 'bg-blue-50',   label: '执行中', dot: 'bg-blue-500' },
  completed:   { icon: CheckCircle, color: 'text-emerald-500',  bg: 'bg-emerald-50', label: '完成',   dot: 'bg-emerald-500' },
  failed:      { icon: XCircle,     color: 'text-red-500',     bg: 'bg-red-50',    label: '失败',   dot: 'bg-red-500' },
  skipped:     { icon: Clock,       color: 'text-gray-400',    bg: 'bg-gray-50',   label: '跳过',   dot: 'bg-gray-300' },
};
const ICONS: Record<string, string> = { trigger:'⚡',test:'🧪',build:'📦',deploy:'🚀',review:'🔍',fix:'🔧',verify:'✅',notify:'📢',research:'📚',synthesize:'📝',present:'📊',done:'🏁',human_approval:'👤',default:'📋' };
function getIcon(s: WorkflowStep): string { if(s.type==='trigger') return '⚡'; const a=(s.action||'').toLowerCase(); for(const[k,v] of Object.entries(ICONS)) if(a.includes(k)) return v; return ICONS.default; }
function fmtTime(ms: number): string { const s=Math.round(ms/1000); return s<60?`${s}s`:`${Math.floor(s/60)}m${s%60?` ${s%60}s`:''}`; }

// ── Tree Node Component ──
function TreeNodeView({ node, depth, isDark }: { node: TreeNode; depth: number; isDark: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const [learningScore, setLearningScore] = useState<number | null>(null);
  const cfg = ST[node.status] || ST.pending;
  const Icon = cfg.icon;
  const icon = getIcon(node.step);

  // v1.2: Fetch learning score for completed steps
  useEffect(() => {
    if (node.status === 'completed' && node.step.agent) {
      fetch(`/api/learning?group=global&limit=20`).then(r => r.json()).then(d => {
        const records = d.records || [];
        const agentRecord = records.find((r: any) => r.agent === node.step.agent && r.stepId === node.step.id);
        if (agentRecord?.evaluation?.total) setLearningScore(agentRecord.evaluation.total);
      }).catch(() => {});
    }
  }, [node.status, node.step.agent, node.step.id]);
  const isActive = node.status === 'in_progress' || node.status === 'waiting';
  const hasChildren = node.children.length > 0;

  return (
    <div className="relative">
      {depth > 0 && <div className={`absolute left-[-12px] top-0 w-3 h-5 border-l-2 border-b-2 rounded-bl-lg ${isDark ? 'border-slate-700' : 'border-gray-200'}`} />}
      <div className={`rounded-lg border p-2.5 mb-1 transition-all ${cfg.bg} ${isActive ? (isDark ? 'border-blue-500/40 shadow-[0_0_12px_rgba(59,130,246,0.1)]' : 'border-blue-400/40 shadow-[0_0_12px_rgba(59,130,246,0.08)]') : (isDark ? 'border-slate-700/50' : 'border-gray-200')}`}
        style={{ marginLeft: depth * 20 }}>
        <div className="flex items-center gap-2">
          {hasChildren && <button onClick={() => setExpanded(!expanded)} className={`p-0.5 rounded ${isDark ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}>{expanded ? <ChevronDown size={12} className={isDark ? 'text-slate-500' : 'text-gray-400'} /> : <ChevronRight size={12} className={isDark ? 'text-slate-500' : 'text-gray-400'} />}</button>}
          {!hasChildren && <div className="w-[18px]" />}
          <span className="text-[13px]">{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`text-[12px] font-medium truncate ${isDark ? 'text-slate-100' : 'text-gray-800'}`}>{node.step.id}</span>
              {node.step.agent && <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${isDark ? 'bg-slate-700 text-slate-400' : 'bg-gray-100 text-gray-500'}`}>{node.step.agent}</span>}
              {node.step.reviewer && <span className={`text-[9px] px-1 py-0.5 rounded ${isDark ? 'bg-violet-500/20 text-violet-400' : 'bg-violet-50 text-violet-600'}`}>→ {node.step.reviewer}</span>}
            </div>
            {node.step.prompt && <p className={`text-[10px] mt-0.5 line-clamp-1 ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>{node.step.prompt.slice(0, 80)}</p>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {learningScore !== null && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                learningScore >= 32 ? 'bg-emerald-100 text-emerald-700' : learningScore >= 24 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
              }`}>{learningScore}/40</span>
            )}
            <div className={`w-2 h-2 rounded-full ${cfg.dot} ${isActive ? 'animate-pulse' : ''}`} />
            <span className={`text-[10px] ${cfg.color}`}>{cfg.label}</span>
          </div>
        </div>
      </div>
      {expanded && hasChildren && (
        <div className="pl-3.5">
          {node.children.map(c => <TreeNodeView key={c.step.id} node={c} depth={depth + 1} isDark={isDark} />)}
        </div>
      )}
    </div>
  );
}

// ── Main Panel ──
export default function FlowPanel({ workflow, run, onClose, onTrigger, onRefresh }: FlowPanelProps) {
  const { theme } = useTheme();
  const isDark = !['notion', 'minimal-white', 'warm-wood', 'solarized-light'].includes(theme);
  const tree = useMemo(() => workflow ? buildTree(workflow.steps, run?.steps || {}) : [], [workflow, run]);
  if (!workflow) return null;

  const total = workflow.steps.filter(s => s.type !== 'trigger').length;
  const done = run ? Object.values(run.steps).filter(s => s === 'completed' || s === 'skipped').length : 0;
  const progress = total > 0 ? done / total : 0;
  const isRunning = run && run.status !== 'completed' && run.status !== 'failed';

  return (
    <div className={`w-[340px] h-full flex flex-col shrink-0 border-l ${isDark ? 'bg-slate-900/95 border-slate-700/50' : 'bg-white border-gray-200'}`}>

      {/* Header */}
      <div className={`p-4 border-b ${isDark ? 'border-slate-700/50' : 'border-gray-200'}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-blue-500 animate-pulse' : run?.status === 'completed' ? 'bg-emerald-500' : run?.status === 'failed' ? 'bg-red-500' : 'bg-gray-300'}`} />
            <h2 className={`text-[14px] font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>{workflow.name}</h2>
          </div>
          <button onClick={onClose} className={`p-1 rounded-lg transition ${isDark ? 'hover:bg-slate-800' : 'hover:bg-gray-100'}`}><X size={14} className={isDark ? 'text-slate-500' : 'text-gray-400'} /></button>
        </div>
        {workflow.description && <p className={`text-[11px] mb-2 ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>{workflow.description}</p>}

        {/* Progress */}
        <div className={`flex items-center justify-between text-[10px] mb-1.5 ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>
          <span>{isRunning ? '执行中' : run?.status === 'completed' ? '已完成' : run?.status === 'failed' ? '失败' : '就绪'}</span>
          <span className="font-mono">{done}/{total}</span>
        </div>
        <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-gray-100'}`}>
          <div className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progress * 100}%`, background: run?.status === 'failed' ? 'linear-gradient(90deg, #ef4444, #f97316)' : 'linear-gradient(90deg, #3b82f6, #22c55e)' }} />
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-3">
          <button onClick={() => onTrigger(workflow.group)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-medium rounded-xl transition ${isDark ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-blue-500 text-white hover:bg-blue-600'}`}>
            <Play size={12} /> 触发运行
          </button>
          {isRunning && (
            <button onClick={() => onRefresh?.()} className={`flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] rounded-xl border transition ${isDark ? 'border-slate-600 text-slate-400 hover:bg-slate-800' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
              <RotateCw size={12} /> 刷新
            </button>
          )}
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className={`text-[10px] font-medium mb-3 uppercase tracking-wider ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>步骤结构</div>
        {tree.map(node => <TreeNodeView key={node.step.id} node={node} depth={0} isDark={isDark} />)}
      </div>

      {/* Run Info */}
      {run && (
        <div className={`p-4 border-t space-y-1.5 ${isDark ? 'border-slate-700/50' : 'border-gray-200'}`}>
          <div className={`flex justify-between text-[10px] ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>
            <span>Run</span><span className={`font-mono ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>{run.runId.slice(0, 8)}</span>
          </div>
          <div className={`flex justify-between text-[10px] ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>
            <span>开始</span><span className={isDark ? 'text-slate-400' : 'text-gray-600'}>{new Date(run.startedAt).toLocaleTimeString()}</span>
          </div>
          {run.completedAt && (
            <div className={`flex justify-between text-[10px] ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>
              <span>耗时</span><span className={isDark ? 'text-slate-400' : 'text-gray-600'}>{fmtTime(run.completedAt - run.startedAt)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
