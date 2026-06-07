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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const gr = await fetch('/api/groups/scan').then(r => r.json());
      const groups: string[] = gr.groups || [];
      const results = await Promise.all(groups.map(g =>
        fetch(`/api/groups/${encodeURIComponent(g)}/workflow`).then(r => r.json()).catch(() => null)
      ));
      const wfs: WorkflowDef[] = [];
      for (let i = 0; i < groups.length; i++) {
        const wr = results[i];
        if (wr && wr.name && Array.isArray(wr.stepsList) && wr.stepsList.length > 0) {
          wfs.push({ group: groups[i], name: wr.name, description: wr.description, steps: wr.stepsList, position: wr.position });
        }
      }
      setWorkflows(wfs);
    } catch { setWorkflows([]); }

    // Load runs
    try {
      const stats = await fetch('/api/system/status').then(r => r.json()).catch(() => null);
      if (stats?.workflows) {
        const runMap: Record<string, RunInfo[]> = {};
        for (const r of stats.workflows.runs || []) {
          if (!runMap[r.group]) runMap[r.group] = [];
          runMap[r.group].push(r);
        }
        setRuns(runMap);
      }
    } catch {}

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll for updates every 5s
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const stats = await fetch('/api/system/status').then(r => r.json()).catch(() => null);
        if (stats?.workflows) {
          const runMap: Record<string, RunInfo[]> = {};
          for (const r of stats.workflows.runs || []) {
            if (!runMap[r.group]) runMap[r.group] = [];
            runMap[r.group].push(r);
          }
          setRuns(runMap);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleTrigger = async (group: string, triggerStepId?: string) => {
    try {
      await fetch('/api/groups/' + group + '/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerStepId }),
      });
      setTimeout(load, 1000);
    } catch {}
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
    </div>
  );
}
