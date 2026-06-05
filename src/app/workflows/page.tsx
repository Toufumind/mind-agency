'use client';
import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/sidebar';
import Link from 'next/link';
import { Play, RefreshCw, CheckCircle, XCircle, GitBranch, ArrowRight, Plus, X, Edit, Trash2, Eye, ThumbsUp, ThumbsDown } from 'lucide-react';
import WorkflowGantt from '@/components/workflow-gantt';
import { useT } from '@/components/i18n';

interface WorkflowDef {
  group: string; name: string; description?: string; steps: number;
  stepsList: { id: string; agent: string; action: string; priority?: string; condition?: string }[];
  yaml?: string;
  runs?: RunInfo[];
  pendingApprovals?: ApprovalInfo[];
}

interface RunInfo {
  runId: string; group: string; workflowName: string; status: string;
  stepsTotal: number; stepsDone: number; startedAt: number; completedAt?: number;
  pendingApprovals: ApprovalInfo[];
}

interface ApprovalInfo { approvalId: string; stepId: string; agent: string; prompt: string; }

export default function WorkflowsPage() {
  const { t } = useT();
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string>('');
  const [approvalMsg, setApprovalMsg] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [editGroup, setEditGroup] = useState('');
  const [editWfName, setEditWfName] = useState('');
  const [editWfDesc, setEditWfDesc] = useState('');
  const [editSteps, setEditSteps] = useState<any[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [showVisual, setShowVisual] = useState(false);
  const [hoveredStep, setHoveredStep] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const gr = await fetch('/api/groups/scan').then(r => r.json());
      const groups: string[] = gr.groups || [];
      const wfs: WorkflowDef[] = [];
      for (const g of groups) {
        try {
          const wr = await fetch(`/api/groups/${g}/workflow`).then(r => r.json());
          if (wr.name && wr.steps > 0) wfs.push({ ...wr, group: g, yaml: wr.yaml, stepsList: wr.stepsList || [], steps: wr.steps });
        } catch {}
      }
      setWorkflows(wfs);
    } catch { setWorkflows([]); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const trigger = async (g: string) => {
    setTriggering(g);
    try { const r = await fetch(`/api/groups/${g}/workflow`, { method: 'POST' }).then(r => r.json()); setApprovalMsg(r.runId ? `启动: ${r.runId.slice(-8)}` : `错误: ${r.error}`); load(); }
    catch (e: any) { setApprovalMsg(e.message); }
    setTriggering('');
  };

  const openEditor = async (g: string) => {
    const r = await fetch(`/api/groups/${g}/workflow`).then(r => r.json());
    setEditGroup(g); setEditWfName(r.name || ''); setEditWfDesc(r.description || '');
    setEditSteps(r.stepsList?.map((s: any) => ({ id: s.id, agent: s.agent || '', action: s.action || '', priority: s.priority || '', condition: s.condition || '', dependsOn: '', prompt: '' })) || []);
    setShowEditor(true);
  };

  const addStep = () => setEditSteps(p => [...p, { id: '', agent: '', action: 'execute', priority: '', condition: '', dependsOn: '', prompt: '' }]);
  const removeStep = (i: number) => setEditSteps(p => p.filter((_, idx) => idx !== i));
  const updateStep = (i: number, f: string, v: string) => setEditSteps(p => p.map((s, idx) => idx === i ? { ...s, [f]: v } : s));

  const saveEditor = async () => {
    setEditSaving(true);
    const steps = editSteps.map((s, i) => {
      const step: any = { id: s.id || `step_${i + 1}`, agent: s.agent, action: s.action };
      if (s.priority) step.priority = s.priority;
      if (s.condition) step.condition = s.condition;
      if (s.prompt) step.prompt = s.prompt;
      if (s.dependsOn) step.dependsOn = s.dependsOn.split(',').map((d: string) => d.trim()).filter(Boolean);
      return step;
    });
    await fetch(`/api/groups/${editGroup}/workflow`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editWfName, description: editWfDesc, steps }) });
    setShowEditor(false); load(); setEditSaving(false);
  };

  const approve = async (g: string, approvalId: string, decision: 'APPROVED' | 'REJECTED') => {
    const r = await fetch(`/api/groups/${g}/workflow`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId, decision }),
    }).then(r => r.json());
    setApprovalMsg(r.ok ? `审批: ${decision}` : `错误: ${r.error}`);
    load();
  };

  const deleteWf = async (g: string) => { await fetch(`/api/groups/${g}/workflow`, { method: 'DELETE' }); setDeleteConfirm(''); load(); };

  // ── Visual DAG layout ──
  const computeDagLayout = (steps: any[]) => {
    if (!steps || steps.length === 0) return [];
    return [steps.map((s, i) => ({ ...s, _idx: i }))];
  };

  const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6'];

  return (
    <div className="flex h-full bg-canvas"><Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-10">
          <div className="flex items-center justify-between mb-8">
            <div><h1 className="text-[24px] font-semibold text-foreground">{t('workflows')}</h1><p className="text-[13px] text-muted-foreground mt-1">{t('workflow_title')}</p></div>
            <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-xl text-[12px] text-muted hover:bg-surface"><RefreshCw size={13}/> {t('refresh')}</button>
          </div>
          {approvalMsg && <div className="mb-6 p-3 bg-sky-50 border border-sky-100 rounded-xl text-[12px] text-sky-700 flex items-center justify-between"><span>{approvalMsg}</span><button onClick={() => setApprovalMsg('')} className="text-sky-400 hover:text-sky-600">×</button></div>}

          {/* ── Execution Analytics ── */}
          {workflows.length > 0 && (() => {
            const allRuns = workflows.flatMap(wf => (wf.runs || []).map(r => ({ ...r, group: wf.group })));
            const completed = allRuns.filter(r => r.status === 'completed');
            const failed = allRuns.filter(r => r.status === 'failed');
            const avgDuration = completed.length > 0
              ? Math.round(completed.reduce((sum, r) => sum + ((r.completedAt || 0) - r.startedAt), 0) / completed.length / 1000)
              : 0;
            const successRate = allRuns.length > 0 ? Math.round((completed.length / allRuns.length) * 100) : 0;
            if (allRuns.length === 0) return null;
            return (
              <div className="mb-6 bg-surface rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-medium text-muted">执行分析</span>
                  <span className="text-[10px] text-muted-foreground">{allRuns.length} 次运行</span>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <div className="text-center">
                    <p className="text-[18px] font-semibold text-foreground">{allRuns.length}</p>
                    <p className="text-[10px] text-muted-foreground">总运行</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[18px] font-semibold text-success">{completed.length}</p>
                    <p className="text-[10px] text-muted-foreground">成功</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[18px] font-semibold text-destructive">{failed.length}</p>
                    <p className="text-[10px] text-muted-foreground">失败</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[18px] font-semibold text-foreground">{successRate}%</p>
                    <p className="text-[10px] text-muted-foreground">成功率</p>
                  </div>
                </div>
                {avgDuration > 0 && (
                  <div className="mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground">
                    平均耗时: {avgDuration < 60 ? `${avgDuration}s` : `${Math.round(avgDuration / 60)}m ${avgDuration % 60}s`}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Visual overview toggle */}
          <div className="flex items-center gap-2 mb-6">
            <button onClick={() => setShowVisual(!showVisual)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${showVisual ? 'bg-surface-alt text-foreground' : 'text-muted hover:text-foreground'}`}>
              <Eye size={13} /> {showVisual ? t('list_view') : t('dag_view')}
            </button>
          </div>

          {loading ? <div className="text-center py-20 text-muted-foreground text-[13px]">{t('loading')}</div> :
           workflows.length === 0 ? <div className="text-center py-20 text-muted-foreground text-[13px]">{t('no_workflows')}</div> : (
            showVisual ? (
              /* ── DAG GANTT VIEW ── */
              <div className="space-y-6">
                {workflows.map(wf => {
                  const run = wf.runs?.[0];
                  const totalSteps = wf.stepsList?.length || 1;
                  const stepsDone = run?.stepsDone || 0;
                  const progress = run ? (run.status === 'completed' ? 1 : stepsDone / totalSteps) : 0;

                  // v0.4: Use real checkpoint data from API
                  const stepsWithTiming = (wf.stepsList || []).map((s: any, i: number) => {
                    const cp = s.checkpoint;
                    return {
                      ...s,
                      status: cp ? cp.status : (run?.status === 'completed' ? 'completed' : run?.status === 'failed' ? 'failed' : 'pending'),
                      startedAt: cp?.startedAt || undefined,
                      completedAt: cp?.completedAt || undefined,
                    };
                  });

                  return (
                    <div key={wf.group}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Link href={`/groups/${wf.group}`} className="text-[13px] font-medium text-foreground hover:underline">{wf.name}</Link>
                          <span className="text-[10px] text-muted-foreground">#{wf.group}</span>
                          <span className="text-[10px] text-muted-foreground">· {wf.steps} 步</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openEditor(wf.group)} className="flex items-center gap-1 px-2 py-1 text-[10px] text-muted hover:text-foreground hover:bg-surface-alt rounded-lg"><Edit size={10}/></button>
                          <button onClick={() => trigger(wf.group)} disabled={triggering === wf.group}
                            className="flex items-center gap-1 px-2.5 py-1 bg-foreground text-canvas text-[10px] rounded-lg hover:opacity-90 disabled:opacity-50">
                            <Play size={10}/> {triggering===wf.group?'...':t('run')}
                          </button>
                        </div>
                      </div>
                      <WorkflowGantt
                        steps={stepsWithTiming}
                        progress={progress}
                        onStepClick={(s) => { openEditor(wf.group); }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              /* ── LIST VIEW ── */
              <div className="space-y-6">
                {workflows.map(wf => (
                  <div key={wf.group} className="bg-canvas border border-border rounded-2xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center"><GitBranch size={14} className="text-indigo-500"/></div>
                        <div>
                          <div className="flex items-center gap-2">
                            <Link href={`/groups/${wf.group}`} className="text-[11px] text-indigo-500 hover:underline">#{wf.group}</Link>
                            <span className="text-[14px] font-medium text-foreground">{wf.name}</span>
                            <span className="text-[11px] text-muted-foreground">{t('workflow_steps', { n: wf.steps })}</span>
                          </div>
                          {wf.description && <p className="text-[11px] text-muted-foreground mt-0.5">{wf.description.slice(0, 100)}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => openEditor(wf.group)} className="flex items-center gap-1 px-2 py-1.5 text-[11px] text-muted hover:text-foreground hover:bg-surface-alt rounded-lg"><Edit size={11}/></button>
                        <button onClick={() => setDeleteConfirm(wf.group)} className="flex items-center gap-1 px-2 py-1.5 text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive-muted rounded-lg"><Trash2 size={11}/></button>
                        <button onClick={() => trigger(wf.group)} disabled={triggering === wf.group}
                          className="flex items-center gap-1 px-3 py-1.5 bg-foreground text-canvas text-[11px] rounded-lg hover:opacity-90 disabled:opacity-50">
                          <Play size={11}/> {triggering===wf.group?t('running'):t('run')}
                        </button>
                      </div>
                      {/* Run status + approvals */}
                      {((wf.runs?.length ?? 0) > 0 || (wf.pendingApprovals?.length ?? 0) > 0) && (
                        <div className="px-6 py-3 border-t border-border bg-surface/30">
                          {wf.runs?.filter(r => r.status === 'running').map(run => (
                            <div key={run.runId} className="flex items-center gap-2 text-[11px]">
                              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                              <span className="text-muted">{run.runId.slice(0, 8)}...</span>
                              <span className="text-muted-foreground">{run.stepsDone}/{run.stepsTotal} steps</span>
                              {run.pendingApprovals.map(a => (
                                <div key={a.approvalId} className="ml-auto flex items-center gap-1">
                                  <span className="text-[10px] text-indigo-500 font-medium">{a.stepId} 待审批</span>
                                  <button onClick={() => approve(wf.group, a.approvalId, 'APPROVED')}
                                    className="flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-medium bg-success text-canvas rounded-md hover:bg-success"><ThumbsUp size={9}/> 批准</button>
                                  <button onClick={() => approve(wf.group, a.approvalId, 'REJECTED')}
                                    className="flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-medium bg-destructive text-canvas rounded-md hover:bg-destructive"><ThumbsDown size={9}/> 拒绝</button>
                                </div>
                              ))}
                            </div>
                          ))}
                          {wf.runs?.filter(r => r.status === 'completed').slice(0, 1).map(run => (
                            <div key={run.runId} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                              <CheckCircle size={10} className="text-success" />
                              <span>{run.runId.slice(0, 8)}... 已完成 ({run.stepsDone}/{run.stepsTotal})</span>
                            </div>
                          ))}
                          {wf.runs?.filter(r => r.status === 'failed').slice(0, 1).map(run => (
                            <div key={run.runId} className="flex items-center gap-2 text-[11px] text-destructive">
                              <XCircle size={10} />
                              <span>{run.runId.slice(0, 8)}... 失败</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* ── Editor Dialog ── */}
          {showEditor && (
            <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center" onClick={() => setShowEditor(false)}>
              <div className="bg-canvas rounded-2xl p-6 shadow-xl w-[750px] max-w-[95vw] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2"><GitBranch size={14} className="text-indigo-500"/> 编辑 #{editGroup} Workflow</h3>
                  <button onClick={() => setShowEditor(false)} className="text-muted-foreground hover:text-muted"><X size={18}/></button>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <input value={editWfName} onChange={e => setEditWfName(e.target.value)} placeholder="名称" className="flex-1 px-3 py-2 border border-border rounded-lg text-[13px] font-medium outline-none focus:border-border-strong"/>
                  <input value={editWfDesc} onChange={e => setEditWfDesc(e.target.value)} placeholder="描述" className="flex-1 px-3 py-2 border border-border rounded-lg text-[12px] outline-none focus:border-border-strong text-muted-foreground"/>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
                  <div className="flex items-center justify-between"><span className="text-[11px] text-muted-foreground font-medium">Steps ({editSteps.length})</span><button onClick={addStep} className="flex items-center gap-1 px-2 py-1 text-[10px] bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg"><Plus size={10}/> 添加</button></div>
                  {editSteps.map((step, i) => (
                    <div key={i} className="bg-surface rounded-xl p-3 border border-border space-y-2">
                      <div className="flex items-center gap-2"><span className="text-[10px] font-mono text-muted-foreground">#{i + 1}</span><button onClick={() => removeStep(i)} className="text-muted-foreground hover:text-destructive ml-auto"><X size={14}/></button></div>
                      <div className="grid grid-cols-2 gap-2">
                        <div><label className="text-[9px] text-muted-foreground mb-0.5 block">Agent *</label><input value={step.agent} onChange={e => updateStep(i, 'agent', e.target.value)} placeholder="如 Alice" className="w-full px-2 py-1.5 text-[12px] bg-canvas border border-border rounded-lg outline-none focus:border-indigo-300"/></div>
                        <div><label className="text-[9px] text-muted-foreground mb-0.5 block">Action *</label><input value={step.action} onChange={e => updateStep(i, 'action', e.target.value)} placeholder="如 review" className="w-full px-2 py-1.5 text-[12px] bg-canvas border border-border rounded-lg outline-none focus:border-indigo-300"/></div>
                        <div><label className="text-[9px] text-muted-foreground mb-0.5 block">依赖步骤</label><input value={step.dependsOn || ''} onChange={e => updateStep(i, 'dependsOn', e.target.value)} placeholder="ID，逗号分隔" className="w-full px-2 py-1.5 text-[11px] bg-canvas border border-border rounded-lg outline-none focus:border-indigo-300 text-muted"/></div>
                        <div><label className="text-[9px] text-muted-foreground mb-0.5 block">条件</label><input value={step.condition || ''} onChange={e => updateStep(i, 'condition', e.target.value)} placeholder="$.code_review.output contains APPROVED" className="w-full px-2 py-1.5 text-[11px] bg-canvas border border-border rounded-lg outline-none focus:border-indigo-300 text-muted font-mono"/></div>
                        <div><label className="text-[9px] text-muted-foreground mb-0.5 block">优先级</label><select value={step.priority || ''} onChange={e => updateStep(i, 'priority', e.target.value)} className="w-full px-2 py-1.5 text-[11px] bg-canvas border border-border rounded-lg outline-none text-muted"><option value="">正常</option><option value="low">低</option><option value="high">高</option><option value="critical">紧急</option></select></div>
                      </div>
                      <div><label className="text-[9px] text-muted-foreground mb-0.5 block">提示词</label><textarea value={step.prompt || ''} onChange={e => updateStep(i, 'prompt', e.target.value)} placeholder={`给 ${step.agent || 'Agent'} 的任务描述...`} rows={2} className="w-full px-2 py-1.5 text-[11px] bg-canvas border border-border rounded-lg outline-none focus:border-indigo-300 text-muted resize-none"/></div>
                    </div>
                  ))}
                  {editSteps.length === 0 && <button onClick={addStep} className="w-full py-8 border-2 border-dashed border-border rounded-xl text-[12px] text-muted-foreground hover:text-muted hover:border-border-strong flex items-center justify-center gap-2"><Plus size={14}/> 添加第一个步骤</button>}
                </div>
                <div className="flex gap-2 justify-end mt-3 shrink-0"><button onClick={() => setShowEditor(false)} className="px-3 py-1.5 text-[11px] text-muted hover:bg-surface rounded-lg">{t('cancel')}</button><button onClick={saveEditor} disabled={editSaving} className="px-4 py-1.5 text-[11px] font-medium text-canvas bg-foreground hover:opacity-90 rounded-lg disabled:opacity-50">{editSaving?t('saving'):t('save')}</button></div>
              </div>
            </div>
          )}

          {/* Delete confirm */}
          {deleteConfirm && (
            <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center" onClick={() => setDeleteConfirm('')}>
              <div className="bg-canvas rounded-2xl p-6 shadow-xl w-[360px]" onClick={e => e.stopPropagation()}><h3 className="text-[14px] font-semibold text-foreground mb-2">删除 #{deleteConfirm} 的 Workflow？</h3><p className="text-[12px] text-destructive mb-4">永久删除 workflow.yaml。</p><div className="flex gap-2 justify-end"><button onClick={() => setDeleteConfirm('')} className="px-3 py-1.5 text-[12px] text-muted hover:bg-surface rounded-lg">取消</button><button onClick={() => deleteWf(deleteConfirm)} className="px-4 py-1.5 text-[12px] font-medium text-canvas bg-destructive hover:bg-destructive rounded-lg">删除</button></div></div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
