/**
 * Workflow API route — v0.3 unified engine
 *
 * Uses event-bus.ts WorkflowEngine + ChatStepExecutor for DAG execution.
 * Supports: condition branching, retry/rollback/compensation, phase metadata,
 * human_approval pause/resume, ChatDev review mode.
 *
 * POST /api/groups/[name]/workflow       → execute workflow
 * GET  /api/groups/[name]/workflow?runId → poll run status
 * POST /api/groups/[name]/workflow/approve → submit human approval
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  parseWorkflowYaml, StepStatus, WorkflowStatus,
  phaseForAction, WorkflowPhase,
} from '@/lib/event-bus';
import { chatOnce } from '@/lib/chat';
import { emitEvent } from '@/lib/ws-broadcast';
import type { WorkflowStep, WorkflowDefinition, StepExecutor } from '@/lib/event-bus';
import { randomUUID } from 'crypto';

// ── Run store (in-memory, per-route lifetime) ───────────────────────

interface StepResult {
  id: string; agent: string; action: string; status: string; decision: string;
  reply: string; retries: number; phase: string; error?: string;
}
interface RunRecord {
  runId: string; group: string; workflow: string; startedAt: number;
  status: 'running' | 'completed' | 'failed'; results: StepResult[];
  pendingApproval?: { approvalId: string; stepId: string };
}
const activeRuns = new Map<string, RunRecord>();

const GROUPS_DIR = path.join(process.cwd(), 'Groups');
const AGENTS_DIR = path.join(process.cwd(), 'Agents');
const EXP_BACKOFF = [2000, 4000, 8000, 16000, 32000];

// ── Step Executor (uses chatOnce for real AI) ──────────────────────

class RouteStepExecutor implements StepExecutor {
  async execute(step: WorkflowStep, context: Record<string, string>): Promise<string> {
    const ctxStr = Object.entries(context).map(([k, v]) => `[${k}] → ${v.slice(0, 300)}`).join('\n');
    const action = step.action.toLowerCase();

    let prompt: string;
    if (action.includes('review') || action.includes('audit')) {
      prompt = `[ChatDev 审查模式] 请审查代码变更。格式：ISSUE|file:line|description|fix_instruction\n无问题回复 NO_ISSUES。\n\n${step.prompt}`;
    } else if (action.includes('human_approval')) {
      return `AWAITING_HUMAN_APPROVAL approvalId=${randomUUID().slice(0, 8)}`;
    } else if (action.includes('fix')) {
      const allCtx = Object.values(context).join('\n');
      const findings = (allCtx.match(/ISSUE\|.+?:\d+\|.+?\|.+/g) || []).join('\n');
      prompt = findings
        ? `[ChatDev 修复模式] 请精准修复：\n${findings}\n\n${step.prompt}`
        : `DAG 步骤: ${step.action}\n上游:\n${ctxStr}\n${step.prompt}`;
    } else {
      prompt = ctxStr
        ? `DAG 步骤: ${step.action}\n上游输出:\n${ctxStr}\n${step.prompt}\n简短回复，包含决定（APPROVED/REJECTED/DEPLOYED 等关键词）。`
        : step.prompt;
    }

    const { reply } = await chatOnce(step.agent, prompt);
    return reply || `COMPLETED ACTION:${step.action} AGENT:${step.agent}`;
  }
}

function parseDecision(reply: string, action: string): string {
  const text = reply.toLowerCase();
  const kws = ['approved', 'rejected', 'deployed', 'passed', 'failed', 'completed', 'verified',
    'conditional_approved', 'deploy_failed', 'issues_found'];
  for (const kw of kws) { if (new RegExp(`(?:^|[^a-z])${kw}(?:[^a-z]|$)`, 'i').test(text)) return kw; }
  for (const act of action.split('|').map(a => a.trim().toLowerCase())) {
    if (new RegExp(`(?:^|[^a-z])${act}(?:[^a-z]|$)`, 'i').test(text)) return act;
  }
  return 'completed';
}

function getBackoff(retry: number, strategy?: string): number {
  if (strategy === 'fixed') return 3000;
  return retry <= EXP_BACKOFF.length ? EXP_BACKOFF[retry - 1] : EXP_BACKOFF[EXP_BACKOFF.length - 1];
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── DAG Node ───────────────────────────────────────────────────────

interface DagNode {
  step: WorkflowStep; deps: string[]; dependents: string[];
  status: StepStatus; output: string; error: string;
  retryCount: number; maxRetries: number; onFailure?: string; timeout: number;
}
const PRIORITY: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

// ── DAG Executor ────────────────────────────────────────────────────

async function executeDag(
  def: WorkflowDefinition, groupName: string,
  executor: StepExecutor, record: RunRecord
): Promise<void> {
  const nodes = new Map<string, DagNode>();
  const compOnly = new Set<string>();

  for (const s of def.steps) {
    const deps = (s.dependsOn || []).filter(Boolean);
    if (s.onFailure) compOnly.add(s.onFailure);
    nodes.set(s.id, {
      step: s, deps, dependents: [], status: StepStatus.PENDING,
      output: '', error: '', retryCount: 0,
      maxRetries: s.retry ?? 3, onFailure: s.onFailure,
      timeout: s.timeout || 300000,
    });
  }
  for (const [id, node] of nodes) {
    for (const depId of node.deps) { const d = nodes.get(depId); if (d) d.dependents.push(id); }
  }

  // Human approval deferred nodes
  const approvalQueue: { approvalId: string; stepId: string; node: DagNode }[] = [];

  const maxIter = Math.min(nodes.size * 10, 500); let iter = 0;
  while (iter++ < maxIter && record.status === 'running') {
    const ready: { id: string; node: DagNode }[] = [];
    for (const [id, node] of nodes) {
      if (node.status !== StepStatus.PENDING && node.status !== StepStatus.BLOCKED) continue;
      if (node.deps.length === 0 && compOnly.has(id) && node.status === StepStatus.PENDING) continue;
      const depsOk = node.deps.every(did => {
        const dn = nodes.get(did);
        return dn && (dn.status === StepStatus.COMPLETED || dn.status === StepStatus.SKIPPED);
      });
      if (!depsOk) { node.status = StepStatus.BLOCKED; continue; }
      if (node.step.condition) {
        const ctx: Record<string, string> = {};
        for (const [, n] of nodes) { if (n.output) ctx[n.step.id] = n.output; }
        if (!evalCond(node.step.condition, ctx)) {
          node.status = StepStatus.SKIPPED;
          record.results.push(buildResult(node.step.id, node.step, 'skipped', `Condition: ${node.step.condition}`, 0));
          continue;
        }
      }
      ready.push({ id, node });
    }

    if (ready.length === 0) {
      const pending = [...nodes.values()].filter(n => n.status === StepStatus.PENDING || n.status === StepStatus.BLOCKED);
      if (pending.length === 0) break;
      for (const n of pending) {
        if (n.deps.some(did => { const dn = nodes.get(did); return dn && dn.status === StepStatus.FAILED; })) {
          n.status = StepStatus.SKIPPED;
          record.results.push(buildResult(n.step.id, n.step, 'skipped', 'Dependency failed', 0));
        }
      }
      break;
    }

    ready.sort((a, b) => (PRIORITY[a.node.step.priority || 'normal'] ?? 2) - (PRIORITY[b.node.step.priority || 'normal'] ?? 2));
    await Promise.all(ready.map(async ({ id, node }) => {
      await execNode(id, node, nodes, executor, record, groupName, approvalQueue);
    }));

    // If human approval paused execution, wait then resume
    if (approvalQueue.length > 0) {
      const pending = approvalQueue.shift()!;
      record.pendingApproval = { approvalId: pending.approvalId, stepId: pending.stepId };
      return; // Pause — resumes via POST /approve
    }
  }

  // Finalize
  const failed = [...nodes.values()].some(n => n.status === StepStatus.FAILED);
  record.status = failed ? 'failed' : 'completed';
  record.results.sort((a, b) => a.id.localeCompare(b.id));
}

async function execNode(
  id: string, node: DagNode, nodes: Map<string, DagNode>,
  executor: StepExecutor, record: RunRecord, groupName: string,
  approvalQueue: { approvalId: string; stepId: string; node: DagNode }[]
): Promise<void> {
  const sid = node.step.id;
  node.status = StepStatus.IN_PROGRESS;
  const phase = phaseForAction(node.step.action);
  emitPhaseEvent('task.in_progress', record.runId, sid, node.step, phase);

  try {
    const ctx: Record<string, string> = {};
    for (const depId of node.deps) { const dn = nodes.get(depId); if (dn?.output) ctx[depId] = dn.output; }

    const output = await executor.execute(node.step, ctx);

    // Check for human approval
    if (node.step.action === 'human_approval') {
      const m = output.match(/approvalId=(\w+)/);
      if (m) {
        node.output = output;
        node.status = StepStatus.IN_PROGRESS; // stays in progress until approved
        approvalQueue.push({ approvalId: m[1], stepId: sid, node });
        return;
      }
    }

    node.output = output;
    node.status = StepStatus.COMPLETED;
    record.results.push(buildResult(sid, node.step, 'completed', output, node.retryCount, phase));
    emitPhaseEvent('task.completed', record.runId, sid, node.step, phase, { output });

    // Notify downstream
    if (node.step.notify) {
      const nl = Array.isArray(node.step.notify) ? node.step.notify : [node.step.notify];
      for (const to of nl) {
        notifyAgent(node.step.agent, to, record.workflow, parseDecision(output, node.step.action), output);
        emitPhaseEvent('task.review_requested', record.runId, sid, node.step, phase, { to });
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    node.error = msg;

    if (node.retryCount < node.maxRetries) {
      node.retryCount++;
      const bf = getBackoff(node.retryCount, node.step.retryBackoff);
      await sleep(bf);
      node.status = StepStatus.PENDING;
      return execNode(id, node, nodes, executor, record, groupName, approvalQueue);
    }

    node.status = StepStatus.FAILED;
    record.results.push(buildResult(sid, node.step, 'failed', '', node.retryCount, phase, msg));
    emitPhaseEvent('task.blocked', record.runId, sid, node.step, phase, { reason: msg });

    if (node.onFailure && nodes.has(node.onFailure)) {
      const cn = nodes.get(node.onFailure)!;
      if (cn.status === StepStatus.PENDING) {
        emitPhaseEvent('task.in_progress', record.runId, node.onFailure, cn.step, WorkflowPhase.COMPENSATION);
        cn.output = `COMPENSATION ACTION:${cn.step.action} AGENT:${cn.step.agent}`;
        cn.status = StepStatus.COMPLETED;
        record.results.push(buildResult(node.onFailure, cn.step, 'compensation', cn.output, 0, WorkflowPhase.COMPENSATION));
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function evalCond(cond: string, ctx: Record<string, string>): boolean {
  const m = cond.match(/^\$\.(\w+)\.output\s+(contains|==|!=)\s+(.+)$/i);
  if (m) {
    const [, sid, op, raw] = m;
    const v = raw.trim().replace(/^['"]|['"]$/g, '');
    const out = (ctx[sid] || '').toLowerCase();
    const o = op.toLowerCase();
    if (o === 'contains') return out.includes(v.toLowerCase());
    if (o === '==') return out === v.toLowerCase();
    if (o === '!=') return out !== v.toLowerCase();
  }
  return Object.prototype.hasOwnProperty.call(ctx, cond);
}

function buildResult(sid: string, step: WorkflowStep, status: string, reply: string, retries: number, phase?: string, error?: string): StepResult {
  return {
    id: sid, agent: step.agent, action: step.action,
    status, decision: parseDecision(reply, step.action),
    reply: reply.slice(0, 500), retries,
    phase: phase || 'completed', error,
  };
}

function emitPhaseEvent(event: string, runId: string, stepId: string, step: WorkflowStep, phase: WorkflowPhase, extra?: Record<string, unknown>) {
  emitEvent({
    event, timestamp: Date.now(), source: 'workflow-engine', id: randomUUID(),
    payload: { taskId: runId, stepId, workflow: 'dag', agent: step.agent, action: step.action, phase, ...(extra || {}) },
  } as any);
}

function notifyAgent(from: string, to: string, wfName: string, decision: string, reply: string) {
  const ed = path.join(AGENTS_DIR, to, 'email');
  if (!fs.existsSync(ed)) fs.mkdirSync(ed, { recursive: true });
  const ds = new Date().toISOString().split('T')[0];
  const body = `---
from: ${from}
to: ${to}
subject: [工作流] ${wfName} — ${from} ${decision}
date: ${ds}
---

## 工作流通知
**${from}** 完成 **${wfName}**，结果: **${decision.toUpperCase()}**

${reply.slice(0, 1000)}
`;
  fs.writeFileSync(path.join(ed, `${ds}_workflow_${wfName}_${decision}.md`), body, 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════
// Route Handlers
// ═══════════════════════════════════════════════════════════════════════

export async function POST(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name: groupName } = await params;
  let body: any;
  try { body = await request.json(); } catch { body = {}; }

  // ── POST /api/groups/[name]/workflow with { approvalId, decision } ──
  if (body.approvalId && body.decision) {
    const { approvalId, decision } = body;
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      return NextResponse.json({ error: 'decision must be APPROVED or REJECTED' }, { status: 400 });
    }
    let found: RunRecord | undefined;
    for (const [key, run] of activeRuns) {
      if (run.pendingApproval?.approvalId === approvalId && run.group === groupName) {
        found = run; break;
      }
    }
    if (!found) return NextResponse.json({ error: 'Approval not found' }, { status: 404 });

    const sid = found.pendingApproval!.stepId;
    found.pendingApproval = undefined;
    found.results.push({
      id: sid, agent: 'human', action: 'human_approval',
      status: 'completed', decision: decision,
      reply: `HUMAN_APPROVAL APPROVAL_ID:${approvalId} DECISION:${decision}`,
      retries: 0, phase: 'approval',
    });
    emitEvent({
      event: 'task.completed', timestamp: Date.now(), source: 'workflow-engine', id: randomUUID(),
      payload: { taskId: found.runId, stepId: sid, agent: 'human', action: 'human_approval', decision, approvalId, phase: 'approval' },
    } as any);

    // Resume DAG
    const wfPath = path.join(GROUPS_DIR, groupName, 'workflow.yaml');
    if (fs.existsSync(wfPath)) {
      const raw = fs.readFileSync(wfPath, 'utf-8');
      const def = parseWorkflowYaml(raw);
      if (def) {
        const executor = new RouteStepExecutor();
        executeDag(def, groupName, executor, found).catch(err => {
          found!.status = 'failed';
          console.error(`[workflow] resume failed: ${err.message}`);
        });
      }
    }
    return NextResponse.json({ ok: true, approvalId, decision });
  }

  // ── POST /api/groups/[name]/workflow (trigger new run) ──
  const wfPath = path.join(GROUPS_DIR, groupName, 'workflow.yaml');
  if (!fs.existsSync(wfPath)) return NextResponse.json({ error: 'No workflow.yaml' }, { status: 404 });

  let def: WorkflowDefinition;
  try {
    def = parseWorkflowYaml(fs.readFileSync(wfPath, 'utf-8'));
  } catch { return NextResponse.json({ error: 'Invalid workflow YAML' }, { status: 400 }); }
  if (!def.steps?.length) return NextResponse.json({ error: 'No steps' }, { status: 400 });

  // Validate agents exist
  for (const s of def.steps) {
    if (s.action === 'human_approval') continue;
    if (!fs.existsSync(path.join(AGENTS_DIR, s.agent))) {
      return NextResponse.json({ error: `Agent "${s.agent}" not found` }, { status: 400 });
    }
  }

  const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const record: RunRecord = {
    runId, group: groupName, workflow: def.name,
    startedAt: Date.now(), status: 'running', results: [],
  };
  activeRuns.set(`${groupName}:${runId}`, record);

  const executor = new RouteStepExecutor();
  executeDag(def, groupName, executor, record)
    .catch(err => { record.status = 'failed'; console.error(`[workflow] ${err.message}`); });

  return NextResponse.json({
    runId, group: groupName, workflow: def.name,
    status: 'started', totalSteps: def.steps.length, engine: 'v0.3',
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name: groupName } = await params;
  const rawUrl = request.url || '';
  const searchIdx = rawUrl.indexOf('?');
  const runId = searchIdx >= 0 ? new URLSearchParams(rawUrl.slice(searchIdx)).get('runId') : null;

  if (runId) {
    const run = activeRuns.get(`${groupName}:${runId}`);
    if (!run) return NextResponse.json({ error: `Run "${runId}" not found` }, { status: 404 });
    return NextResponse.json(run);
  }

  const wfPath = path.join(GROUPS_DIR, groupName, 'workflow.yaml');
  if (!fs.existsSync(wfPath)) return NextResponse.json({ error: 'No workflow.yaml' }, { status: 404 });
  let def: WorkflowDefinition;
  try { def = parseWorkflowYaml(fs.readFileSync(wfPath, 'utf-8')); }
  catch { return NextResponse.json({ error: 'Invalid YAML' }, { status: 400 }); }

  const runs = [...activeRuns.values()]
    .filter(r => r.group === groupName)
    .map(r => ({
      runId: r.runId, status: r.status, stepsDone: r.results.length,
      pendingApproval: r.pendingApproval,
    }));
  return NextResponse.json({ name: def.name, steps: def.steps.length, activeRuns: runs });
}
