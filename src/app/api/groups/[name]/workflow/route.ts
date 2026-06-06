/**
 * Workflow API
 *
 * GET    /api/groups/{name}/workflow           → read workflow YAML + runs
 * POST   /api/groups/{name}/workflow           → trigger | approve | reject
 * PUT    /api/groups/{name}/workflow           → update YAML
 * DELETE /api/groups/{name}/workflow           → delete YAML
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from '@/lib/data-dir';
import { parseWorkflowYaml } from '@/lib/event-bus';
import { triggerWorkflow, approveWorkflow, getRuns, getPendingApprovals } from '@/lib/workflow-bridge';
import { loadRunHistory, loadRunCheckpoints } from '@/lib/workflow-checkpoint';

const WF_FILE = 'workflow.yaml';

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
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const history = loadRunHistory(name, limit);
    return NextResponse.json({ history });
  }

  const wfPath = path.join(GROUPS_DIR, name, WF_FILE);
  if (!fs.existsSync(wfPath)) {
    return NextResponse.json({ name: '', steps: 0, yaml: '' });
  }

  const raw = fs.readFileSync(wfPath, 'utf-8');
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

  // YAML update via POST
  if (body.yaml || body.steps) {
    return handleUpdate(name, body);
  }

  // Trigger
  const result = await triggerWorkflow(name);
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
  const wfPath = path.join(GROUPS_DIR, name, WF_FILE);
  if (!fs.existsSync(wfPath)) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }
  fs.unlinkSync(wfPath);
  return NextResponse.json({ success: true });
}

// ── Helpers ────────────────────────────────────────────────

async function handleUpdate(group: string, body: any) {
  const wfPath = path.join(GROUPS_DIR, group, WF_FILE);

  let yaml: string;
  if (typeof body.yaml === 'string' && body.yaml.trim()) {
    yaml = body.yaml;
    try { parseWorkflowYaml(yaml); } catch {
      return NextResponse.json({ error: 'Invalid YAML: cannot parse workflow' }, { status: 400 });
    }
  } else if (Array.isArray(body.steps)) {
    // Read existing workflow name if not provided
    let wfName = body.name || '';
    if (!wfName && fs.existsSync(wfPath)) {
      try {
        const existing = parseWorkflowYaml(fs.readFileSync(wfPath, 'utf-8'));
        wfName = existing.name || group;
      } catch { wfName = group; }
    }
    const lines = [
      `name: ${wfName}`,
      body.description ? `description: "${body.description}"` : '',
      'steps:',
    ].filter(Boolean);
    for (const s of body.steps) {
      lines.push(`  - id: ${s.id || s.agent}`);
      lines.push(`    agent: ${s.agent || 'unknown'}`);
      lines.push(`    action: ${s.action || 'execute'}`);
      if (s.dependsOn) {
        const deps = Array.isArray(s.dependsOn) ? s.dependsOn.join(', ') : s.dependsOn;
        lines.push(`    dependsOn: [${deps}]`);
      }
      if (s.condition) lines.push(`    condition: "${s.condition}"`);
      if (s.prompt) lines.push(`    prompt: |\n      ${s.prompt.replace(/\n/g, '\n      ')}`);
      if (s.priority) lines.push(`    priority: ${s.priority}`);
      if (s.retry) lines.push(`    retry: ${s.retry}`);
      if (s.timeout) lines.push(`    timeout: ${s.timeout}`);
    }
    yaml = lines.join('\n') + '\n';
  } else {
    return NextResponse.json({ error: 'Provide yaml string or {name, steps[]}' }, { status: 400 });
  }

  fs.writeFileSync(wfPath, yaml, 'utf-8');
  return NextResponse.json({ success: true, group });
}
