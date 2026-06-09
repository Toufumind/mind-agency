'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from '@/components/sidebar';
import WorkflowArch from '@/components/workflow-arch';
import { useT } from '@/components/i18n';

interface WorkflowStep {
  id: string; type?: string; agent?: string; action?: string; prompt?: string;
  dependsOn?: string[]; routes?: { step: string; when: string }[];
  reviewer?: string; priority?: string; trigger?: any; evaluate?: boolean;
}

interface WorkflowDef {
  group: string; name: string; description?: string;
  steps: WorkflowStep[]; position?: { x: number; y: number };
}

interface RunInfo {
  runId: string; status: string; steps: Record<string, string>;
  startedAt: number; completedAt?: number;
}

export default function WorkflowsPage() {
  const { t } = useT();
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [runs, setRuns] = useState<Record<string, RunInfo[]>>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{msg:string;type:'ok'|'error'}|null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = useCallback((msg: string, type: 'ok'|'error' = 'ok') => {
    clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const gr = await fetch('/api/groups/scan').then(r => r.json());
      const groups: string[] = gr.groups || [];
      const results = await Promise.all(groups.map(g =>
        fetch(`/api/groups/${encodeURIComponent(g)}/workflow`).then(r => r.json()).catch(() => null)
      ));
      const wfs: WorkflowDef[] = [];
      const runMap: Record<string, RunInfo[]> = {};
      for (let i = 0; i < groups.length; i++) {
        const wr = results[i];
        if (wr && wr.name && Array.isArray(wr.stepsList) && wr.stepsList.length > 0) {
          wfs.push({ group: groups[i], name: wr.name, description: wr.description, steps: wr.stepsList, position: wr.position });
        }
        if (wr?.runs) runMap[groups[i]] = wr.runs;
      }
      setWorkflows(wfs);
      setRuns(runMap);
    } catch { setWorkflows([]); showToast('加载工作流失败', 'error'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll for run status
  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!active) return;
      try {
        const gr = await fetch('/api/groups/scan').then(r => r.json());
        const groups: string[] = gr.groups || [];
        const results = await Promise.all(groups.map(g =>
          fetch(`/api/groups/${encodeURIComponent(g)}/workflow?action=runs`).then(r => r.json()).catch(() => null)
        ));
        if (!active) return;
        const newRuns: Record<string, RunInfo[]> = {};
        for (let i = 0; i < groups.length; i++) {
          if (results[i]?.runs) newRuns[groups[i]] = results[i].runs;
        }
        setRuns(newRuns);
      } catch {}
      timeout = setTimeout(poll, 8000);
    };
    poll();
    return () => { active = false; clearTimeout(timeout); };
  }, []);

  const handleTrigger = async (group: string) => {
    try {
      const res = await fetch('/api/groups/' + group + '/workflow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) { const err = await res.json().catch(() => ({ error: 'Unknown' })); showToast(`触发失败: ${err.error}`, 'error'); return; }
      showToast(`已触发 ${group}`, 'ok');
      setTimeout(load, 1000);
    } catch (e) { showToast(`错误: ${e instanceof Error ? e.message : 'Unknown'}`, 'error'); }
  };

  return (
    <div className="flex h-full bg-canvas">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-10">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-[18px] font-semibold text-foreground" style={{ fontFamily: 'Georgia, serif' }}>
              Workflow Architectures
            </h1>
            <p className="text-[12px] text-muted-foreground mt-1">
              {workflows.length} workflow{workflows.length !== 1 ? 's' : ''} across {Object.keys(runs).length} group{Object.keys(runs).length !== 1 ? 's' : ''}
            </p>
          </div>

          {loading ? (
            <div className="text-center py-20 text-muted-foreground text-[13px]">{t('loading')}</div>
          ) : workflows.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground text-[13px]">{t('no_workflows')}</div>
          ) : (
            <div className="space-y-10">
              {workflows.map(wf => {
                const latestRun = runs[wf.group]?.[0] || null;
                const isRunning = latestRun?.status === 'running';
                return (
                  <div key={wf.group} className="border border-border rounded-2xl bg-white p-6 shadow-sm">
                    {/* Workflow header */}
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-medium text-muted-foreground bg-surface px-2 py-0.5 rounded">{wf.group}</span>
                          <h3 className="text-[14px] font-semibold text-foreground">{wf.name}</h3>
                        </div>
                        {wf.description && <p className="text-[11px] text-muted-foreground mt-1">{wf.description}</p>}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {latestRun && (
                          <span className={`px-2 py-0.5 rounded font-medium ${
                            latestRun.status === 'running' ? 'bg-blue-50 text-blue-600' :
                            latestRun.status === 'completed' ? 'bg-emerald-50 text-emerald-600' :
                            'bg-gray-50 text-gray-500'
                          }`}>{latestRun.status}</span>
                        )}
                      </div>
                    </div>

                    {/* Architecture diagram */}
                    <WorkflowArch
                      steps={wf.steps}
                      run={latestRun}
                      onTrigger={() => handleTrigger(wf.group)}
                      running={isRunning}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-4 py-2.5 rounded-xl text-[12px] font-medium shadow-xl backdrop-blur-md transition-all duration-300 ${
          toast.type === 'ok' ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white'
        }`}>{toast.msg}</div>
      )}
    </div>
  );
}
