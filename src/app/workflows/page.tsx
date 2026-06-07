'use client';
import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/sidebar';
import FlowCanvas from '@/components/flow-canvas';
import FlowPanel from '@/components/flow-panel';
import { useT } from '@/components/i18n';

interface WorkflowStep {
  id: string; type?: string; agent?: string; action?: string; prompt?: string;
  dependsOn?: string[]; routes?: { step: string; when: string }[];
  reviewer?: string; priority?: string; trigger?: any;
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
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{msg:string;type:'ok'|'error'}|null>(null);

  const showToast = useCallback((msg: string, type: 'ok'|'error' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
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
        // Extract runs from the per-group workflow response
        if (wr?.runs) {
          runMap[groups[i]] = wr.runs;
        }
      }
      setWorkflows(wfs);
      setRuns(runMap);
    } catch (e) { setWorkflows([]); showToast('加载工作流失败', 'error'); }

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll for run status updates every 5s
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const gr = await fetch('/api/groups/scan').then(r => r.json()).catch(() => null);
        const groups: string[] = gr?.groups || [];
        const runMap: Record<string, RunInfo[]> = {};
        await Promise.all(groups.map(async (g) => {
          try {
            const data = await fetch(`/api/groups/${encodeURIComponent(g)}/workflow?action=runs`).then(r => r.json());
            if (data?.runs) runMap[g] = data.runs;
          } catch {}
        }));
        setRuns(runMap);
      } catch {}
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleTrigger = async (group: string, triggerStepId?: string) => {
    try {
      const res = await fetch('/api/groups/' + group + '/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerStepId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        showToast(`触发失败: ${err.error || res.statusText}`, 'error');
        return;
      }
      showToast(`已触发 ${group} 工作流`, 'ok');
      setTimeout(load, 1000);
    } catch (e) {
      showToast(`网络错误: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
  };

  const selectedWorkflow = workflows.find(w => w.group === selectedGroup) || null;
  const selectedRun = selectedGroup ? (runs[selectedGroup]?.[0] || null) : null;

  return (
    <div className="flex h-full bg-canvas">
      <Sidebar />
      <main className="flex-1 flex overflow-hidden">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-[13px]">{t('loading')}</div>
        ) : workflows.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-[13px]">{t('no_workflows')}</div>
        ) : (
          <>
            {/* Canvas */}
            <FlowCanvas
              workflows={workflows}
              runs={runs}
              onSelectWorkflow={setSelectedGroup}
              selectedGroup={selectedGroup}
              onTrigger={handleTrigger}
              onRefresh={load}
            />

            {/* Right Panel */}
            {selectedGroup && (
              <FlowPanel
                workflow={selectedWorkflow}
                run={selectedRun}
                onClose={() => setSelectedGroup(null)}
                onTrigger={handleTrigger}
              />
            )}
          </>
        )}
      </main>

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-4 py-2.5 rounded-xl text-[12px] font-medium shadow-xl backdrop-blur-md transition-all duration-300 ${
          toast.type === 'ok'
            ? 'bg-emerald-500/90 text-white'
            : 'bg-red-500/90 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
