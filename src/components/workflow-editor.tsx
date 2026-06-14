'use client';

import { useState } from 'react';
import { X, Plus, Trash2, Eye, EyeOff } from 'lucide-react';

// ═══════ Workflow Editor Modal ═══════
// Extracted from groups/[name]/page.tsx per frontend-ui-engineering skill

interface WorkflowStep {
  id: string;
  agent: string;
  action: string;
  prompt?: string;
  condition?: string;
  dependsOn?: string[];
  status?: string;
  reviewer?: string;
  priority?: string;
}

interface WorkflowDef {
  name: string;
  description?: string;
  steps: number;
  stepsList: WorkflowStep[];
  runs?: any[];
  pendingApprovals?: any[];
}

export function WorkflowEditor({
  workflow, editSteps, setEditSteps, show, onClose, onSave,
  wfRuns, showRunHistory, setShowRunHistory,
}: {
  workflow: WorkflowDef | null;
  editSteps: any[];
  setEditSteps: (steps: any[]) => void;
  show: boolean;
  onClose: () => void;
  onSave: () => void;
  wfRuns: any[];
  showRunHistory: boolean;
  setShowRunHistory: (v: boolean) => void;
}) {
  if (!show) return null;

  const addStep = () => {
    setEditSteps([...editSteps, {
      id: `step_${editSteps.length + 1}`,
      agent: '',
      action: 'execute',
      prompt: '',
    }]);
  };

  const updateStep = (i: number, field: string, value: any) => {
    const n = [...editSteps];
    n[i] = { ...n[i], [field]: value };
    setEditSteps(n);
  };

  const removeStep = (i: number) => {
    setEditSteps(editSteps.filter((_, idx) => idx !== i));
  };

  return (
    <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center"
      onClick={onClose}>
      <div className="bg-canvas rounded-2xl shadow-xl w-[700px] max-w-[95vw] max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <span className="text-[13px] font-semibold text-foreground">
            编辑 Workflow · {workflow?.name}
          </span>
          <button onClick={onClose} className="text-muted-foreground hover:text-muted">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Steps editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-muted">
                步骤 ({editSteps.length})
              </span>
              <button onClick={addStep}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-muted">
                <Plus size={10} /> 添加
              </button>
            </div>
            <div className="space-y-2">
              {editSteps.map((s, i) => (
                <div key={i} className="bg-surface rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-muted-foreground">#{i + 1}</span>
                    <input value={s.id} onChange={e => updateStep(i, 'id', e.target.value)}
                      placeholder="step_id"
                      className="flex-1 px-2 py-1 text-[11px] bg-canvas border border-border rounded-md outline-none focus:border-border-strong" />
                    <input value={s.agent} onChange={e => updateStep(i, 'agent', e.target.value)}
                      placeholder="agent"
                      className="w-20 px-2 py-1 text-[11px] bg-canvas border border-border rounded-md outline-none focus:border-border-strong" />
                    <input value={s.action} onChange={e => updateStep(i, 'action', e.target.value)}
                      placeholder="action"
                      className="w-20 px-2 py-1 text-[11px] bg-canvas border border-border rounded-md outline-none focus:border-border-strong" />
                    <button onClick={() => removeStep(i)}
                      className="text-muted-foreground hover:text-destructive">
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <textarea value={s.prompt || ''} onChange={e => updateStep(i, 'prompt', e.target.value)}
                    placeholder="任务描述..." rows={2}
                    className="w-full px-2 py-1 text-[11px] bg-canvas border border-border rounded-md outline-none focus:border-border-strong resize-none" />
                  <div className="flex items-center gap-2">
                    <input value={(s.dependsOn || []).join(', ')}
                      onChange={e => updateStep(i, 'dependsOn', e.target.value.split(',').map((d: string) => d.trim()).filter(Boolean))}
                      placeholder="依赖 (逗号分隔)"
                      className="flex-1 px-2 py-1 text-[10px] bg-canvas border border-border rounded-md outline-none focus:border-border-strong" />
                    <input value={s.reviewer || ''} onChange={e => updateStep(i, 'reviewer', e.target.value)}
                      placeholder="审查者"
                      className="w-24 px-2 py-1 text-[10px] bg-canvas border border-border rounded-md outline-none focus:border-border-strong" />
                    <select value={s.priority || ''} onChange={e => updateStep(i, 'priority', e.target.value)}
                      className="px-2 py-1 text-[10px] bg-canvas border border-border rounded-md outline-none">
                      <option value="">正常</option>
                      <option value="low">低</option>
                      <option value="high">高</option>
                      <option value="critical">紧急</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Run history */}
          {wfRuns.length > 0 && (
            <div>
              <button onClick={() => setShowRunHistory(!showRunHistory)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-muted mb-2">
                {showRunHistory ? <EyeOff size={11} /> : <Eye size={11} />}
                运行历史 ({wfRuns.length})
              </button>
              {showRunHistory && (
                <div className="space-y-1 opacity-50">
                  {wfRuns.slice(0, 10).map((r: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 px-2 py-1 bg-surface rounded text-[10px]">
                      <span className={`w-1.5 h-1.5 rounded-full ${r.status === 'completed' ? 'bg-success' : r.status === 'failed' ? 'bg-destructive' : 'bg-muted'}`} />
                      <span className="text-muted-foreground">{new Date(r.completedAt || r.startedAt).toLocaleString()}</span>
                      <span className="text-foreground">{r.stepsCompleted}/{r.stepsTotal} 步</span>
                      <span className="text-muted-foreground">{r.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2 shrink-0">
          <button onClick={onClose}
            className="px-3 py-1.5 text-[11px] text-muted hover:bg-surface rounded-lg">
            取消
          </button>
          <button onClick={onSave}
            className="px-4 py-1.5 text-[11px] font-medium text-canvas bg-foreground rounded-lg hover:opacity-90">
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
