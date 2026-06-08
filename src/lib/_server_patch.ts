
  // ── GET /api/workflows (dashboard: per-group latest run) ─────────

  if (req.method === 'GET' && req.url === '/api/workflows') {
    const byGroup = workflowEngine.getRunsByGroup();
    const groups = Object.keys(byGroup);
    const summary = {
      groupCount: groups.length,
      activeGroups: groups.filter(g => byGroup[g].status === 'running').length,
      completedGroups: groups.filter(g => byGroup[g].status === 'completed').length,
      failedGroups: groups.filter(g => byGroup[g].status === 'failed').length,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, summary, workflows: byGroup }, null, 2));
    return;
  }
