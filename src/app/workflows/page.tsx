'use client';

import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/sidebar';
import Link from 'next/link';
import { Play, RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, GitBranch, UserCheck, ArrowRight, Hash } from 'lucide-react';

interface WorkflowDef { group: string; name: string; description?: string; steps: number; stepsList: { id: string; agent: string; action: string; priority?: string; condition?: string }[]; }
interface RunStatus { runId: string; status: string; stepsDone: number; pendingApproval?: { approvalId: string; stepId: string }; }
interface RunDetail { runId: string; workflow: string; status: string; results: { id: string; agent: string; action: string; status: string; decision: string; phase: string; retries: number; error?: string }[]; pendingApproval?: { approvalId: string; stepId: string }; }

const PHASE_COLORS: Record<string, string> = {
  review: 'bg-blue-100 text-blue-700', approval: 'bg-amber-100 text-amber-700',
  deploy: 'bg-purple-100 text-purple-700', verify: 'bg-green-100 text-green-700',
  compensation: 'bg-red-100 text-red-700', completed: 'bg-gray-100 text-gray-600',
  skipped: 'bg-gray-50 text-gray-400', failed: 'bg-red-50 text-red-600',
  in_progress: 'bg-sky-50 text-sky-600',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  completed: <CheckCircle size={14} className="text-green-500" />,
  running: <Clock size={14} className="text-sky-500 animate-pulse" />,
  failed: <XCircle size={14} className="text-red-500" />,
  skipped: <AlertTriangle size={14} className="text-gray-300" />,
};

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [runs, setRuns] = useState<Record<string, RunStatus[]>>({});
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string>('');
  const [approvalMsg, setApprovalMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch groups
      const gr = await fetch('/api/groups/scan').then(r => r.json());
      const groups: string[] = gr.groups || [];
      const wfs: WorkflowDef[] = [];
      const runMap: Record<string, RunStatus[]> = {};

      for (const g of groups) {
        try {
          const wr = await fetch(`/api/groups/${g}/workflow`).then(r => r.json());
          if (wr.name && wr.steps > 0) {
            wfs.push({
              group: g, name: wr.name, description: wr.description,
              steps: wr.steps, stepsList: [],
            });
            runMap[g] = wr.activeRuns || [];
          }
        } catch {}
      }

      // Fetch step lists for each workflow
      for (const wf of wfs) {
        try {
          const yr = await fetch(`/api/groups/${wf.group}/workflow`).then(r => r.json());
          // We already have the info from the first call
        } catch {}
      }

      setWorkflows(wfs);
      setRuns(runMap);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const trigger = async (group: string) => {
    setTriggering(group);
    try {
      const r = await fetch(`/api/groups/${group}/workflow`, { method: 'POST' }).then(r => r.json());
      if (r.runId) { setApprovalMsg(`Workflow ${r.workflow} started: ${r.runId}`); load(); }
      else setApprovalMsg(`Error: ${r.error}`);
    } catch (e: any) { setApprovalMsg(`Error: ${e.message}`); }
    finally { setTriggering(''); }
  };

  const loadDetail = async (group: string, runId: string) => {
    try {
      const r = await fetch(`/api/groups/${group}/workflow?runId=${runId}`).then(r => r.json());
      setDetail(r);
    } catch {}
  };

  const approve = async (group: string, approvalId: string, decision: string) => {
    try {
      const r = await fetch(`/api/groups/${group}/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId, decision }),
      }).then(r => r.json());
      if (r.ok) { setApprovalMsg(`Approval ${decision} submitted`); load(); setDetail(null); }
      else setApprovalMsg(`Error: ${r.error}`);
    } catch (e: any) { setApprovalMsg(`Error: ${e.message}`); }
  };

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-10">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-[24px] font-semibold text-gray-900">Workflows</h1>
              <p className="text-[13px] text-gray-400 mt-1">DAG pipeline management — v0.3</p>
            </div>
            <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-xl text-[12px] text-gray-600 hover:bg-gray-50">
              <RefreshCw size={13} /> Refresh
            </button>
          </div>

          {approvalMsg && (
            <div className="mb-6 p-3 bg-sky-50 border border-sky-100 rounded-xl text-[12px] text-sky-700 flex items-center justify-between">
              <span>{approvalMsg}</span>
              <button onClick={() => setApprovalMsg('')} className="text-sky-400 hover:text-sky-600">×</button>
            </div>
          )}

          {loading ? (
            <div className="text-center py-20 text-gray-400 text-[13px]">Loading...</div>
          ) : workflows.length === 0 ? (
            <div className="text-center py-20 text-gray-400 text-[13px]">
              No workflows found. Create Groups/&lt;name&gt;/workflow.yaml to get started.
            </div>
          ) : (
            <div className="space-y-6">
              {workflows.map(wf => {
                const groupRuns = runs[wf.group] || [];
                return (
                  <div key={wf.group} className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
                    {/* Header */}
                    <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                          <GitBranch size={14} className="text-indigo-500" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <Link href={`/groups/${wf.group}`} className="text-[11px] text-indigo-500 hover:underline">#{wf.group}</Link>
                            <span className="text-[14px] font-medium text-gray-800">{wf.name}</span>
                            <span className="text-[11px] text-gray-400">{wf.steps} steps</span>
                          </div>
                          {wf.description && <p className="text-[11px] text-gray-400 mt-0.5">{wf.description.slice(0, 100)}</p>}
                        </div>
                      </div>
                      <button
                        onClick={() => trigger(wf.group)}
                        disabled={triggering === wf.group}
                        className="flex items-center gap-1 px-3 py-1.5 bg-gray-900 text-white text-[11px] rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-all"
                      >
                        <Play size={12} /> {triggering === wf.group ? 'Running...' : 'Trigger'}
                      </button>
                    </div>

                    {/* Active Runs */}
                    {groupRuns.length > 0 && (
                      <div className="px-6 py-3 bg-gray-50/50">
                        {groupRuns.map(run => (
                          <div key={run.runId}>
                            <div
                              className="flex items-center gap-3 py-2 cursor-pointer hover:bg-white/50 rounded px-2 -mx-2"
                              onClick={() => loadDetail(wf.group, run.runId)}
                            >
                              {STATUS_ICONS[run.status] || <Clock size={14} />}
                              <span className="text-[12px] font-mono text-gray-500">{run.runId.slice(-8)}</span>
                              <span className={`text-[11px] px-1.5 py-0.5 rounded ${run.status === 'completed' ? 'bg-green-50 text-green-600' : run.status === 'failed' ? 'bg-red-50 text-red-600' : 'bg-sky-50 text-sky-600'}`}>
                                {run.status}
                              </span>
                              <span className="text-[11px] text-gray-400">{run.stepsDone} steps</span>
                              {run.pendingApproval && (
                                <span className="flex items-center gap-1 text-[11px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                                  <UserCheck size={11} /> Awaiting Approval
                                </span>
                              )}
                            </div>

                            {/* Inline approval UI */}
                            {run.pendingApproval && (
                              <div className="ml-8 mb-2 p-3 bg-amber-50 border border-amber-100 rounded-xl flex items-center gap-3">
                                <UserCheck size={14} className="text-amber-600" />
                                <span className="text-[12px] text-amber-700 font-medium">Approve: {run.pendingApproval.approvalId}</span>
                                <button onClick={(e) => { e.stopPropagation(); approve(wf.group, run.pendingApproval!.approvalId, 'APPROVED'); }}
                                  className="px-3 py-1 bg-green-500 text-white text-[11px] rounded-lg hover:bg-green-600">Approve</button>
                                <button onClick={(e) => { e.stopPropagation(); approve(wf.group, run.pendingApproval!.approvalId, 'REJECTED'); }}
                                  className="px-3 py-1 bg-red-500 text-white text-[11px] rounded-lg hover:bg-red-600">Reject</button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Detail panel */}
                    {detail && detail.runId && runs[wf.group]?.some(r => r.runId === detail.runId) && (
                      <div className="px-6 py-4 border-t border-gray-100">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-[12px] font-medium text-gray-500 flex items-center gap-2">
                            <ArrowRight size={12} /> Run {detail.runId.slice(-12)}
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${detail.status === 'completed' ? 'bg-green-50 text-green-600' : 'bg-sky-50 text-sky-600'}`}>
                              {detail.status}
                            </span>
                          </h3>
                          <button onClick={() => setDetail(null)} className="text-[11px] text-gray-400 hover:text-gray-600">Close</button>
                        </div>
                        <div className="space-y-1">
                          {detail.results?.map((r: any, i: number) => (
                            <div key={i} className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-gray-50">
                              <span className="w-6 text-center">{STATUS_ICONS[r.status] || <Clock size={14} />}</span>
                              <span className={`text-[10px] px-1 py-0.5 rounded ${PHASE_COLORS[r.phase] || 'bg-gray-100 text-gray-500'}`}>
                                {r.phase || r.status}
                              </span>
                              <span className="text-[12px] text-gray-700 font-medium w-16">{r.agent}</span>
                              <span className="text-[11px] text-gray-500">{r.action}</span>
                              <span className={`text-[11px] ml-auto ${r.decision === 'approved' || r.decision === 'completed' ? 'text-green-600' : r.decision === 'rejected' || r.decision === 'failed' ? 'text-red-500' : 'text-gray-400'}`}>
                                {r.decision}
                              </span>
                              {r.retries > 0 && <span className="text-[10px] text-amber-500">↻{r.retries}</span>}
                              {r.error && <span className="text-[10px] text-red-400 ml-2">{r.error.slice(0, 40)}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
