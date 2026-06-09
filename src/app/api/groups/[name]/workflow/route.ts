/**
 * Workflow API
 *
 * GET    /api/groups/{name}/workflow           → read workflow YAML + runs
 * POST   /api/groups/{name}/workflow           → trigger | approve | reject
 * PUT    /api/groups/{name}/workflow           → update YAML
 * DELETE /api/groups/{name}/workflow           → delete YAML
 */

import { NextRequest, NextResponse } from 'next/server';
import * as yamlLib from 'js-yaml';
import { getAgency } from '@/lib/agency';
import { parseWorkflowYaml } from '@/lib/event-bus';
import { triggerWorkflow, approveWorkflow, getRuns, getPendingApprovals } from '@/lib/workflow-bridge';
import { loadRunHistory, loadRunCheckpoints } from '@/lib/workflow-checkpoint';

// ── GET — read workflow definition + runs ──────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const { searchParams } = new URL(request.url);

  // ?action=runs — get workflow execution status
  if (searchParams.get('action') === 'runs') {
    const runs = getRuns().filter(r => r.group === name);
    const approvals = getPendingApprovals(name);
    return NextResponse.json({ runs, pendingApprovals: approvals });
  }

  // ?action=history — get completed workflow run history (v0.4)
  if (searchParams.get('action') === 'history') {
    const limit = Math.max(1, Math.min(200, parseInt(searchParams.get('limit') || '50', 10) || 50));
    const history = loadRunHistory(name, limit);
    return NextResponse.json({ history });
  }

  const agency = getAgency();
  const proxy = agency.getGroup(name);

  if (!proxy.exists()) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  const raw = await proxy.getWorkflow();
  if (!raw) {
    return NextResponse.json({ name: '', steps: 0, yaml: '' });
  }

  try {
    const def = parseWorkflowYaml(raw);
    const runs = getRuns().filter(r => r.group === name);

    // v0.4: Load checkpoint data for the latest run
    const latestRun = runs[0];
    let checkpoints: Record<string, any> = {};
    if (latestRun) {
      const cps = loadRunCheckpoints(name, latestRun.runId);
      for (const cp of cps) { checkpoints[cp.stepId] = cp; }
    }

    return NextResponse.json({
      name: def.name,
      description: def.description,
      steps: def.steps.length,
      stepsList: def.steps.map(s => ({
        id: s.id, type: s.type, agent: s.agent, action: s.action,
        prompt: s.prompt, priority: s.priority, condition: s.condition,
        dependsOn: s.dependsOn || [], routes: s.routes,
        reviewer: s.reviewer, trigger: s.trigger,
        checkpoint: checkpoints[s.id] || null,
      })),
      yaml: raw,
      runs,
      pendingApprovals: getPendingApprovals(name),
    });
  } catch {
    return NextResponse.json({ name: '', steps: 0, yaml: raw, error: 'parse error' });
  }
}

// ── POST — trigger | approve | reject ──────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  let body: any;
  try { body = await request.json(); } catch { body = {}; }

  // Approval?
  if (body.approvalId && body.decision) {
    const decision = body.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    const result = approveWorkflow(body.approvalId, decision, body.comment);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ ok: true, approvalId: body.approvalId, decision });
  }

  // Callback — agent reports step completion
  if (body.runId && body.stepId) {
    const { getEngine } = await import('@/lib/workflow-bridge');
    const engine = getEngine();
    const output = `${(body.status || 'COMPLETED').toUpperCase()}: ${body.summary || ''}${body.details ? '\n' + body.details : ''}`;
    const ok = engine.callback(body.runId, body.stepId, output);
    if (!ok) return NextResponse.json({ error: 'callback failed (run not found or step not waiting)' }, { status: 400 });
    return NextResponse.json({ ok: true, runId: body.runId, stepId: body.stepId, status: body.status });
  }

  // YAML update via POST
  if (body.yaml || body.steps) {
    return handleUpdate(name, body);
  }

  // Trigger
  const result = await triggerWorkflow(name, body.triggerStepId);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, runId: result.runId, group: name });
}

// ── PUT — update YAML ──────────────────────────────────────

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  let body: any;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  return handleUpdate(name, body);
}

// ── DELETE ─────────────────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  const agency = getAgency();
  const proxy = agency.getGroup(name);

  if (!proxy.exists()) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  // Clear workflow by saving empty yaml
  await proxy.saveWorkflow('');

  return NextResponse.json({ success: true });
}

// ── Helpers ────────────────────────────────────────────────

async function handleUpdate(group: string, body: any) {
  const agency = getAgency();
  const proxy = agency.getGroup(group);

  if (!proxy.exists()) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  let yaml = '';
  if (typeof body.yaml === 'string' && body.yaml.trim()) {
    yaml = body.yaml;
    try { parseWorkflowYaml(yaml); } catch {
      return NextResponse.json({ error: 'Invalid YAML: cannot parse workflow' }, { status: 400 });
    }
  } else if (Array.isArray(body.steps)) {
    // Read existing workflow name if not provided
    let wfName = body.name || '';
    if (!wfName) {
      const existingYaml = await proxy.getWorkflow();
      if (existingYaml) {
        try {
          const existing = parseWorkflowYaml(existingYaml);
          wfName = existing.name || group;
        } catch { wfName = group; }
      } else {
        wfName = group;
      }
    }
    // Build structured object, then serialize with yaml.dump (safe, no injection)
    const wfObj: any = { name: wfName, steps: [] };
    if (body.description) wfObj.description = body.description;
    for (const s of body.steps) {
      const step: any = { id: s.id || s.agent || `step_${wfObj.steps.length}`, agent: s.agent || 'unknown', action: s.action || 'execute' };
      if (s.dependsOn) step.dependsOn = Array.isArray(s.dependsOn) ? s.dependsOn : [s.dependsOn];
      if (s.condition) step.condition = s.condition;
      if (s.prompt) step.prompt = s.prompt;
      if (s.priority) step.priority = s.priority;
      if (s.retry) step.retry = s.retry;
      if (s.timeout) step.timeout = s.timeout;
      if (s.reviewer) step.reviewer = s.reviewer;
      if (s.routes) step.routes = s.routes;
      wfObj.steps.push(step);
    }
    yaml = yamlLib.dump(wfObj);
  } else {
    return NextResponse.json({ error: 'Provide yaml string or {name, steps[]}' }, { status: 400 });
  }

  await proxy.saveWorkflow(yaml);
  return NextResponse.json({ success: true, group });
}
