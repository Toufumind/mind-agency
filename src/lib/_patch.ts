
  /** GET /api/workflows — per-group workflow status dashboard data */
  getRunsByGroup(): Record<string, {
    runId: string; workflowName: string; status: string;
    startedAt: number; completedAt?: number;
    durationMs?: number;
    steps: Record<string, string>; retries: number;
    rollbacks: number; compensations: number;
    stepReports: Array<{ stepId: string; agent: string; status: string; summary: string; timestamp: number }>;
    totalRuns: number; completedRuns: number; failedRuns: number;
  }> {
    const seen = new Set<string>();
    const byGroup = new Map<string, WorkflowRunRecord[]>();
    for (const r of this.runs.values()) {
      if (seen.has(r.runId)) continue;
      seen.add(r.runId);
      const group = (r as any)._group as string || '_ungrouped';
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group)!.push(r);
    }
    const result: Record<string, any> = {};
    for (const [group, runs] of byGroup) {
      runs.sort((a, b) => b.startedAt - a.startedAt);
      const latest = runs[0];
      const stepsObj: Record<string, string> = {};
      for (const [sid, s] of latest.steps) stepsObj[sid] = s;
      let retries = 0;
      for (const v of latest.stepRetries.values()) retries += v;
      const reports = [...latest.taskReports.values()].map(tr => ({
        stepId: tr.stepId, agent: tr.agent, status: tr.status,
        summary: tr.summary, timestamp: tr.timestamp,
      }));
      result[group] = {
        runId: latest.runId,
        workflowName: latest.workflowName,
        status: latest.status,
        startedAt: latest.startedAt,
        completedAt: latest.completedAt,
        durationMs: latest.completedAt ? latest.completedAt - latest.startedAt : Date.now() - latest.startedAt,
        steps: stepsObj,
        retries,
        rollbacks: latest.rollbacks.length,
        compensations: latest.compensations.length,
        stepReports: reports,
        totalRuns: runs.length,
        completedRuns: runs.filter(r => r.status === WorkflowStatus.COMPLETED).length,
        failedRuns: runs.filter(r => r.status === WorkflowStatus.FAILED).length,
      };
    }
    return result;
  }
