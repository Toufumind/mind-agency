/**
 * Workflow Engine — extracted from event-bus.ts
 *
 * Workflow Engine: YAML-parsed DAG execution, JSONPath condition branching,
 * retry/rollback/compensation, priority scheduling, pluggable StepExecutor.
 *
 * Used by: server.ts (WebSocket on :3001)
 */

import { randomUUID } from 'crypto';
import * as yaml from 'js-yaml';
import fs from 'fs';
import { atomicWrite } from './atomic';
import path from 'path';
import os from 'os';
import { AUDIT_DIR, AGENTS_DIR, GROUPS_DIR, MIND_DIR } from './data-dir';
import { broadcastWs } from './ws-embedded';
import { enqueueTask, completeTask } from './task-queue';
import { checkToolPermission } from './permission-engine';
import {
  saveRunMeta, saveStepCheckpoint, completeRunCheckpoint,
  appendRunHistory, findIncompleteRuns, cleanupCheckpoints,
  type StepCheckpoint,
} from './workflow-checkpoint';
import { EventBus, EventType, createEvent } from './event-bus';

// ═══════════════════════════════════════════════════ Workflow Engine ═══

export enum StepStatus { PENDING = 'pending', BLOCKED = 'blocked', IN_PROGRESS = 'in_progress', WAITING = 'waiting', COMPLETED = 'completed', SKIPPED = 'skipped', FAILED = 'failed' }
export enum WorkflowStatus { IDLE = 'idle', RUNNING = 'running', COMPLETED = 'completed', FAILED = 'failed' }

/** v0.3 P1: Workflow phase tags — MetaGPT-style stage markers for pipeline visualization */
export enum WorkflowPhase {
  REQUIREMENT = 'requirement', DESIGN = 'design', REVIEW = 'review',
  APPROVAL = 'approval', DEPLOY = 'deploy', VERIFY = 'verify',
  COMPENSATION = 'compensation', COMPLETED = 'completed',
}

/** Map step action to workflow phase */
export function phaseForAction(action?: string): WorkflowPhase {
  const a = (action || '').toLowerCase();
  if (a.includes('review')) return WorkflowPhase.REVIEW;
  if (a.includes('approve')) return WorkflowPhase.APPROVAL;
  if (a.includes('reject')) return WorkflowPhase.REVIEW;
  if (a.includes('deploy')) return WorkflowPhase.DEPLOY;
  if (a.includes('verify') || a.includes('test')) return WorkflowPhase.VERIFY;
  if (a.includes('compensat') || a.includes('notify') || a.includes('rollback')) return WorkflowPhase.COMPENSATION;
  if (a.includes('design')) return WorkflowPhase.DESIGN;
  if (a.includes('require')) return WorkflowPhase.REQUIREMENT;
  return WorkflowPhase.COMPLETED;
}

export interface WorkflowStepRoute { step: string; when: string; }
export interface WorkflowStep { id: string; type?: 'step' | 'trigger'; agent?: string; action?: string; prompt?: string; trigger?: WorkflowTrigger; notify?: string | string[]; condition?: string; dependsOn?: string[]; routes?: WorkflowStepRoute[]; timeout?: number; onFailure?: string; onReject?: string; onApprove?: string; maxRejectRetries?: number; retry?: number; retryBackoff?: 'fixed' | 'exponential'; priority?: 'low' | 'normal' | 'high' | 'critical'; reviewer?: string; reviewPrompt?: string; evaluate?: boolean; reward?: number; budget?: number; }
export interface WorkflowTrigger {
  type: 'manual' | 'file_change' | 'schedule' | 'event';
  /** For schedule: cron expression (e.g. "0 9 * * 1-5") */
  cron?: string;
  /** For event: EventBus event type to listen for */
  eventType?: string;
  /** For event: optional filter on event payload (e.g., { group: 'dev' }) */
  eventFilter?: { group?: string; agent?: string };
  /** For file_change: file path to watch */
  watchFile?: string;
  /** For file_change: debounce interval in ms */
  debounceMs?: number;
}
export interface WorkflowDefinition { name: string; description?: string; steps: WorkflowStep[]; source?: string; concurrency?: number; trigger?: WorkflowTrigger; }
export interface TaskReport { stepId: string; agent: string; status: string; summary: string; details: string; timestamp: number; }
export interface WorkflowRunRecord { runId: string; workflowName: string; startedAt: number; completedAt?: number; status: WorkflowStatus; steps: Map<string, StepStatus>; stepRetries: Map<string, number>; rollbacks: Array<{ stepId: string; reason: string; timestamp: number }>; compensations: string[]; taskReports: Map<string, TaskReport>; group?: string; }

export interface StepExecutor { execute(step: WorkflowStep, context: Record<string, string>): Promise<string>; }


export function parseReviewFindings(output: string): Array<{ file: string; line: number; desc: string; fix: string }> {
  if (output.includes('NO_ISSUES')) return [];
  const findings: Array<{ file: string; line: number; desc: string; fix: string }> = [];
  const lines = output.split('\n');
  for (const line of lines) {
    const m = line.match(/ISSUE\|(.+?):(\d+)\|(.+?)\|(.+)/);
    if (m) findings.push({ file: m[1].trim(), line: parseInt(m[2]), desc: m[3].trim(), fix: m[4].trim() });
  }
  return findings;
}

/** Simulated executor — synthetic outputs for dev/testing, ChatDev-style reviews */
export class SimulatedStepExecutor implements StepExecutor {
  async execute(step: WorkflowStep, ctx: Record<string, string>): Promise<string> {
    const a = (step.action || '').toLowerCase();
    const agent = step.agent || 'unknown';
    const action = step.action || 'execute';
    if (a.includes('review') || a.includes('audit')) {
      // ChatDev-style: precise file:line findings
      const findings = [
        `ISSUE|src/lib/event-bus.ts:173|backpressure check may race with unsubscribe|Move backpressure increment after filter match, use atomic counter`,
        `ISSUE|src/lib/scheduler.ts:38|tick() does not await pollAllAgents, may lose errors|Add try/catch around await and emit poll.error on failure`,
      ];
      // If context contains prior review findings, add a fix-verification note
      const prevReview = Object.values(ctx).find(v => v.includes('ISSUE|'));
      if (prevReview) {
        findings.push(`ISSUE|src/lib/event-bus.ts:173|prior fix not verified — re-review needed|Re-check backpressure logic after fix`);
      }
      return `REVIEW_COMPLETE ACTION:${action} AGENT:${agent} DECISION:APPROVED\n${findings.join('\n')}`;
    }
    if (a.includes('approve')) return `APPROVED ACTION:${action} AGENT:${agent}`;
    if (a.includes('reject')) return `REJECTED ACTION:${action} AGENT:${agent}`;
    if (a.includes('deploy')) return `DEPLOYED+PASSED ACTION:${action} AGENT:${agent}`;
    if (a.includes('verify') || a.includes('test')) return `VERIFIED ACTION:${action} AGENT:${agent}`;
    if (a.includes('fix') || a.includes('修复')) {
      // Fixer step: extract findings from context and produce targeted fixes
      const allFindings = Object.values(ctx).flatMap(v => parseReviewFindings(v));
      if (allFindings.length > 0) {
        return `FIXED ${allFindings.length} issues — ACTION:${action} AGENT:${agent}\n${allFindings.map(f => `FIXED|${f.file}:${f.line}|${f.desc}`).join('\n')}`;
      }
      return `FIXED ACTION:${action} AGENT:${agent}`;
    }
    if (a.includes('notify')) return `NOTIFIED ACTION:${action} AGENT:${agent}`;
    return `COMPLETED ACTION:${action} AGENT:${agent}`;
  }
}

/** Production executor — calls agent via chatOnce (real AI) with model fallback */
export class ChatStepExecutor implements StepExecutor {
  async execute(step: WorkflowStep, ctx: Record<string, string>): Promise<string> {
    const { chatOnce } = await import('./chat');
    // v1.1: Build context from upstream steps — smart truncation, not fixed 500 chars
    // Total context budget: 4000 chars. Split proportionally among upstream outputs.
    const entries = Object.entries(ctx);
    const totalLen = entries.reduce((sum, [, v]) => sum + v.length, 0);
    const BUDGET = 4000;
    const ctxStr = entries
      .map(([k, v]) => {
        if (k.includes('.')) {
          // Task report field (e.g., "step1.status", "step1.summary")
          return `[${k}]: ${v}`;
        }
        // Proportional truncation: give more space to larger outputs
        const limit = entries.length === 1 ? BUDGET : Math.max(500, Math.floor(BUDGET * v.length / totalLen));
        const truncated = v.length > limit ? v.slice(0, limit) + `\n...(共 ${v.length} 字，截取前 ${limit} 字)` : v;
        return `[上游步骤 ${k} 的输出]\n${truncated}`;
      })
      .join('\n\n');

    // v1.2: Query learning records — inject past feedback so agent avoids repeating mistakes
    const agent = step.agent || 'unknown';
    let learningHint = '';
    try {
      const evalDir = path.join(MIND_DIR, 'learning');
      if (fs.existsSync(evalDir)) {
        // Search all group learning files for this agent's past rejections
        const files = fs.readdirSync(evalDir).filter(f => f.startsWith('learning-') && f.endsWith('.jsonl'));
        const pastRejections: string[] = [];
        for (const f of files) {
          const lines = fs.readFileSync(path.join(evalDir, f), 'utf-8').split('\n').filter(Boolean);
          for (const line of lines.slice(-30)) { // Last 30 records per group
            try {
              const r = JSON.parse(line);
              if (r.agent === agent && r.evaluation?.verdict === 'NEEDS_REVISION' && r.evaluation?.feedback) {
                pastRejections.push(`[${r.stepId || r.workflow}] ${r.evaluation.feedback.slice(0, 200)}`);
              }
            } catch {}
          }
        }
        if (pastRejections.length > 0) {
          const unique = [...new Set(pastRejections)].slice(-3); // Last 3 unique rejections
          learningHint = `\n\n---\n\n【历史反馈 — 请避免以下问题】\n${unique.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
        }
      }
    } catch {}

    // v0.4: Step is a notification — agent does the work and reports via task tool
    const promptSuffix = `\n\n---\n\n【重要】完成任务后，请用 task 工具报告结果：
task(action="report", step_id="${step.id}", status="APPROVED 或 REJECTED", summary="你的结果摘要", details="详细说明")
这一步的结果会被工作流引擎读取。`;

    const prompt = ctxStr
      ? `[工作流上下文]\n${ctxStr}\n\n---\n\n你的任务:\n${step.prompt}${learningHint}${promptSuffix}`
      : `${step.prompt}${learningHint}${promptSuffix}`;

    // ── Permission check — every step execution goes through the engine ──
    const action = step.action || 'execute';
    const perm = checkToolPermission(agent, `workflow_step_${action}`, { stepId: step.id, action });
    if (!perm.allowed) {
      throw new Error(`步骤 ${step.id} (${action}) 需要审批: ${perm.message}`);
    }

    // ── Execution with model fallback ──
    let models = ['mimo-v2.5'];
    try {
      const settingsPath = path.join(MIND_DIR, 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (settings.model) models = [settings.model];
      }
    } catch {}
    let lastError: unknown;

    for (let i = 0; i < models.length; i++) {
      try {
        console.log(`[wf] ChatStepExecutor → ${agent} (${action}) model=${models[i]} len=${prompt.length}`);
        // Pass model override to chatOnce — this sidesteps ANTHROPIC_MODEL env var
        const { createChatStream } = await import('./chat');
        const stream = await createChatStream(agent, prompt, undefined, models[i]);
        const reader = stream.getReader();
        let reply = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.type === 'text') reply += value.content || '';
          if (value.type === 'error') throw new Error(value.content || 'Unknown error');
        }

        // v0.4: Read structured result from task report file
        const reportDir = path.join(MIND_DIR, 'agents', agent, '.task-reports');
        const reportPath = path.join(reportDir, `${step.id}.json`);
        if (fs.existsSync(reportPath)) {
          try {
            const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
            console.log(`[wf] ChatStepExecutor ← ${agent} task_report=${report.summary?.slice(0, 100)}`);
            // Clean up the report file
            fs.unlinkSync(reportPath);
            return `${report.status}: ${report.summary}${report.details ? '\n' + report.details : ''}`;
          } catch {}
        }

        // Fallback: use text output if agent didn't write to memory
        console.log(`[wf] ChatStepExecutor ← ${agent} text=${reply.slice(0, 100)} (no memory entry)`);
        return reply || `EMPTY_REPLY ACTION:${action} AGENT:${agent}`;
      } catch (e: unknown) {
        lastError = e;
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[wf] ChatStepExecutor ${models[i]} failed: ${msg}${i < models.length - 1 ? ' → trying fallback ' + models[i + 1] : ''}`);
        // Continue to next fallback model
      }
    }

    throw new Error(`ChatStepExecutor exhausted all models: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
}

export function createStepExecutor(): StepExecutor { return process.env.WORKFLOW_EXECUTOR === 'simulated' ? new SimulatedStepExecutor() : new ChatStepExecutor(); }

/** Parse workflow YAML — supports snake_case aliases */
export function parseWorkflowYaml(raw: string): WorkflowDefinition {
  const p = yaml.load(raw) as Record<string, any>;
  if (!p || typeof p !== 'object') throw new Error('Invalid workflow YAML');
  const sl = p.steps || p.tasks || [];
  if (!Array.isArray(sl)) throw new Error('YAML "steps" must be an array');
  // Parse trigger config
  let trigger: WorkflowTrigger | undefined;
  if (p.trigger) {
    trigger = {
      type: p.trigger.type || 'manual',
      cron: p.trigger.cron,
      eventType: p.trigger.event_type || p.trigger.eventType,
      watchFile: p.trigger.watch_file || p.trigger.watchFile,
      debounceMs: p.trigger.debounce_ms || p.trigger.debounceMs || 5000,
    };
  }

  const steps = sl.map((s: any, i: number) => {
    const isTrigger = s.type === 'trigger' || (!s.agent && !s.prompt && s.trigger);
    const trigger: WorkflowTrigger | undefined = s.trigger ? {
      type: s.trigger.type || 'manual',
      cron: s.trigger.cron,
      eventType: s.trigger.event_type || s.trigger.eventType,
      eventFilter: s.trigger.event_filter || s.trigger.eventFilter,
      watchFile: s.trigger.watch_file || s.trigger.watchFile,
      debounceMs: s.trigger.debounce_ms || s.trigger.debounceMs || 5000,
    } : undefined;

    return {
      id: s.id || `step_${i}`,
      type: isTrigger ? 'trigger' as const : 'step' as const,
      agent: s.agent || (isTrigger ? undefined : 'unknown'),
      action: s.action || (isTrigger ? 'trigger' : 'execute'),
      prompt: s.prompt || '',
      trigger,
      notify: s.notify, condition: s.condition,
      dependsOn: s.dependsOn || (s.depends_on ? (Array.isArray(s.depends_on) ? s.depends_on : [s.depends_on]) : undefined) || (s.depends ? (Array.isArray(s.depends) ? s.depends : [s.depends]) : undefined),
      timeout: s.timeout || 300000, onFailure: s.on_failure || s.onFailure || undefined,
      onReject: s.on_reject || s.onReject || undefined,
      onApprove: s.on_approve || s.onApprove || undefined,
      routes: Array.isArray(s.routes) ? s.routes.map((r: any) => ({ step: r.step || r.target, when: r.when || r.condition || '' })) : undefined,
      maxRejectRetries: typeof s.max_reject_retries === 'number' ? Math.min(s.max_reject_retries, 10) : typeof s.maxRejectRetries === 'number' ? Math.min(s.maxRejectRetries, 10) : undefined,
      retry: typeof s.retry === 'number' ? Math.min(s.retry, 10) : undefined,
      retryBackoff: s.retry_backoff || s.retryBackoff || undefined,
      priority: s.priority || undefined, reviewer: s.reviewer || undefined,
      reviewPrompt: s.review_prompt || s.reviewPrompt || undefined,
      reward: typeof s.reward === 'number' ? s.reward : undefined,
      budget: typeof s.budget === 'number' ? s.budget : undefined,
    };
  });

  // v0.4: Validate — duplicate step IDs
  const ids = steps.map(s => s.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) throw new Error(`重复的步骤 ID: ${[...new Set(dupes)].join(', ')}`);

  // v0.4: Validate — circular dependencies
  const stepMap = new Map(steps.map(s => [s.id, s]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const colors = new Map<string, number>();
  const dfs = (id: string): boolean => {
    colors.set(id, GRAY);
    const s = stepMap.get(id);
    if (s) {
      const deps = Array.isArray(s.dependsOn) ? s.dependsOn : [];
      for (const dep of deps) {
        if (!stepMap.has(dep)) continue;
        const c = colors.get(dep);
        if (c === GRAY) return true; // cycle
        if (c === undefined && dfs(dep)) return true;
      }
    }
    colors.set(id, BLACK);
    return false;
  };
  for (const s of steps) {
    if (!colors.has(s.id) && dfs(s.id)) {
      throw new Error(`检测到循环依赖，请检查步骤之间的依赖关系`);
    }
  }

  return { name: p.name || 'unnamed', description: p.description, concurrency: typeof p.concurrency === 'number' ? p.concurrency : undefined, trigger, steps };
}

// ── DAG internal types ──────────────────────────────────────────────

export interface DagNode { step: WorkflowStep; deps: string[]; dependents: string[]; status: StepStatus; output: string; error: string; retryCount: number; maxRetries: number; rejectCount: number; maxRejectRetries: number; onFailure?: string; onReject?: string; onApprove?: string; routes?: WorkflowStepRoute[]; timeout: number; startedAt: number; notifiedAt: number; }
const PRIORITY: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

// ═══════════════════════════════════════════════════ WorkflowEngine ═══

export class WorkflowEngine {
  private runs = new Map<string, WorkflowRunRecord>();
  /** Maps workflow name → latest runId (avoids overwriting older run records) */
  private latestRuns = new Map<string, string>();
  private bus?: EventBus;
  private executor: StepExecutor;
  /** v0.3 P2: Human approval inbox — approvalId → { runId, stepId, node } */
  private pendingApprovals = new Map<string, { runId: string; stepId: string; node: DagNode; nodes: Map<string, DagNode> }>();
  /** v0.4: Abort controllers per run for cancellation */
  private abortControllers = new Map<string, AbortController>();

  constructor(bus?: EventBus, executor?: StepExecutor) { this.bus = bus; this.executor = executor || createStepExecutor(); }

  /** Execute a workflow — starts DAG asynchronously. Returns run record immediately. */
  execute(def: WorkflowDefinition, group?: string, triggerStepId?: string): WorkflowRunRecord {
    const runId = randomUUID();
    const rec: WorkflowRunRecord = { runId, workflowName: def.name, startedAt: Date.now(), status: WorkflowStatus.RUNNING, steps: new Map(def.steps.map(s => [s.id, StepStatus.PENDING])), stepRetries: new Map(), rollbacks: [], compensations: [], taskReports: new Map() };
    if (group) rec.group = group;
    this.runs.set(runId, rec);
    this.latestRuns.set(def.name, runId);
    // v0.4: Register abort controller
    const ac = new AbortController();
    this.abortControllers.set(runId, ac);

    // v0.4: Save run checkpoint
    if (group) {
      saveRunMeta(group, runId, { workflowName: def.name, startedAt: rec.startedAt, status: 'running' });
    }

    if (this.bus) this.bus.emit(createEvent(EventType.TASK_CREATED, { taskId: runId, title: `Workflow: ${def.name}`, stepsTotal: def.steps.length }, 'workflow-engine'));
    // v0.5: DO NOT mark run as completed here — schedule() handles completion
    // when all steps finish via callbacks. The old code immediately marked the
    // run as COMPLETED after initial scheduling, killing callback processing.
    this.executeDag(runId, def, triggerStepId).catch((err: Error) => {
      const r = this.runs.get(runId);
      if (r) { r.status = WorkflowStatus.FAILED; r.completedAt = Date.now(); }
      if (group) {
        completeRunCheckpoint(group, runId, 'failed', err.message || 'Unknown error');
        const stepsCompleted = [...(r?.steps.values() || [])].filter(s => s === StepStatus.COMPLETED).length;
        const stepsFailed = [...(r?.steps.values() || [])].filter(s => s === StepStatus.FAILED).length;
        appendRunHistory(group, {
          runId, workflowName: def.name, group,
          startedAt: rec.startedAt, completedAt: Date.now(),
          status: 'failed', stepsTotal: def.steps.length,
          stepsCompleted, stepsFailed,
          compensations: r?.compensations.length || 0,
        });
      }
      if (this.bus) this.bus.emit(createEvent(EventType.TASK_BLOCKED, { taskId: runId, error: err.message }, 'workflow-engine'));
      // v0.9: Don't evict on error — let runs persist for status queries
    });
    return rec;
  }

  // ── Core DAG execution ────────────────────────────────────────────

  private async executeDag(runId: string, def: WorkflowDefinition, triggerStepId?: string): Promise<void> {
    const run = this.runs.get(runId); if (!run) return;
    const nodes = new Map<string, DagNode>();
    const compOnly = new Set<string>();

    // Track YAML file for dynamic reload
    const yamlPath = (run as any)._yamlPath as string | undefined;
    let lastYamlMtime = yamlPath ? this.getFileMtime(yamlPath) : 0;

    const addSteps = (steps: WorkflowStep[]) => {
      for (const s of steps) {
        if (nodes.has(s.id)) continue; // skip existing
        if (s.onFailure) compOnly.add(s.onFailure);
        nodes.set(s.id, {
          step: s, deps: s.dependsOn || [], dependents: [],
          status: StepStatus.PENDING, output: '', error: '',
          retryCount: 0, maxRetries: s.retry ?? 3,
          rejectCount: 0, maxRejectRetries: s.maxRejectRetries ?? 3,
          onFailure: s.onFailure, onReject: s.onReject, onApprove: s.onApprove,
          routes: s.routes, timeout: s.timeout || 300000, startedAt: 0, notifiedAt: 0,
        });
      }
      // Rebuild dependent links
      for (const [id, node] of nodes) {
        node.dependents = [];
        for (const [oid, other] of nodes) {
          if (other.deps.includes(id)) node.dependents.push(oid);
        }
      }
      // Sync to run record
      for (const [id, node] of nodes) {
        if (!run.steps.has(id)) run.steps.set(id, node.status);
      }
    };

    addSteps(def.steps);

    // Store nodes for callback lookup
    this.runNodes.set(runId, nodes);

    // ── Auto-complete trigger steps ──
    for (const [id, node] of nodes) {
      if (node.step.type === 'trigger') {
        // If triggerStepId specified, only complete that one; otherwise complete all
        if (triggerStepId && id !== triggerStepId) continue;
        node.status = StepStatus.COMPLETED;
        node.output = JSON.stringify(node.step.trigger || { type: 'manual' });
        run.steps.set(id, StepStatus.COMPLETED);
        console.log(`[wf] Trigger ${id} auto-completed`);
      }
    }

    // ── Cycle detection via DFS ──────────────────────────────────────
    const detectCycle = (nodesMap: Map<string, DagNode>): string | null => {
      const WHITE = 0, GRAY = 1, BLACK = 2;
      const color = new Map<string, number>();
      const parent = new Map<string, string>();
      for (const id of nodesMap.keys()) color.set(id, WHITE);

      const dfs = (u: string): string | null => {
        color.set(u, GRAY);
        const node = nodesMap.get(u);
        if (node) {
          for (const v of node.deps) {
            if (!nodesMap.has(v)) continue;
            if (color.get(v) === GRAY) {
              // Reconstruct cycle path
              const cycle: string[] = [v, u];
              let cur = u;
              while (cur !== v) {
                cur = parent.get(cur) || v;
                if (cur !== v) cycle.push(cur);
              }
              return cycle.reverse().join(' → ') + ' → ' + v;
            }
            if (color.get(v) === WHITE) {
              parent.set(v, u);
              const result = dfs(v);
              if (result) return result;
            }
          }
        }
        color.set(u, BLACK);
        return null;
      };

      for (const id of nodesMap.keys()) {
        if (color.get(id) === WHITE) {
          const cycle = dfs(id);
          if (cycle) return cycle;
        }
      }
      return null;
    };

    // ── Start scheduling (callback model) ──
    // Note: No cycle detection needed — engine skips completed steps
    this.schedule(runId);
  }

  // ── Callback model: step notifies agent → agent calls back ────────────

  /** Store DAG nodes per run (for callback lookup) */
  private runNodes = new Map<string, Map<string, DagNode>>();

  /** Notify agent to execute a step (fire-and-forget) */
  private notifyAgent(runId: string, node: DagNode, nodes: Map<string, DagNode>, ctx: Record<string, string>): void {
    const run = this.runs.get(runId);
    if (!run) return;
    const sid = node.step.id;
    const agent = node.step.agent || 'unknown';

    // Build notification prompt with callback instructions
    const ctxStr = Object.entries(ctx).map(([k, v]) => `[${k}]: ${v.slice(0, 500)}`).join('\n\n');
    // v1.2: Stronger callback instruction — MUST call workflow_callback tool
    const callbackInstr = `\n\n【重要】完成任务后，你必须调用 workflow_callback MCP 工具来报告结果。这是完成步骤的唯一方式。
工具调用格式：workflow_callback(runId="${runId}", stepId="${sid}", status="COMPLETED", summary="你的结果摘要", details="详细说明")
如果不调用此工具，工作流将无法推进到下一步。`;

    const prompt = ctxStr
      ? `[工作流上下文]\n${ctxStr}\n\n---\n\n你的任务:\n${node.step.prompt}${callbackInstr}`
      : `${node.step.prompt}${callbackInstr}`;

    // Emit notification event — the agent's MCP handler will pick this up
    if (this.bus) {
      this.bus.emit(createEvent(EventType.TASK_ASSIGNED, {
        taskId: runId, stepId: sid, workflow: run.workflowName,
        agent, action: node.step.action,
        prompt, phase: phaseForAction(node.step.action),
      }, 'workflow-engine'));
    }

    // Also persist notification to agent's directory so autoRespond can pick it up
    try {
      const notifDir = path.join(AGENTS_DIR, agent, '.workflow-notifications');
      if (!fs.existsSync(notifDir)) fs.mkdirSync(notifDir, { recursive: true });
      const notifPath = path.join(notifDir, `${runId}_${sid}.json`);

      atomicWrite(notifPath, JSON.stringify({ runId, stepId: sid, prompt, createdAt: Date.now() }));
    } catch {}

    node.status = StepStatus.WAITING;
    node.notifiedAt = Date.now();
    run.steps.set(sid, StepStatus.WAITING);

    // Add to agent's task queue
    enqueueTask(agent, {
      runId, stepId: sid, workflow: run.workflowName,
      prompt: node.step.prompt || '',
      priority: (node.step.priority as any) || 'normal',
    });

    console.log(`[wf] Notified ${agent} for ${sid} (run ${runId.slice(0, 8)})`);
  }

  /** Handle callback from agent — step completed */
  callback(runId: string, stepId: string, output: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.status !== WorkflowStatus.RUNNING) {
      console.log(`[wf] Callback FAILED: run ${runId.slice(0, 8)} not found or not running (status: ${run?.status})`);
      return false;
    }
    const nodes = this.runNodes.get(runId);
    if (!nodes) {
      console.log(`[wf] Callback FAILED: no nodes for run ${runId.slice(0, 8)}`);
      return false;
    }
    const node = nodes.get(stepId);
    if (!node || node.status !== StepStatus.WAITING) {
      console.log(`[wf] Callback FAILED: step ${stepId} not found or not waiting (status: ${node?.status})`);
      return false;
    }

    console.log(`[wf] Callback: ${stepId} ← ${output.slice(0, 100)} (run ${runId.slice(0, 8)})`);

    // Complete task in agent's task queue
    const agentName = node.step.agent || 'unknown';
    const isFailed = /FAILED|ERROR/i.test(output);
    completeTask(agentName, runId, stepId, output.slice(0, 500), isFailed ? 'failed' : 'completed');

    // Clean up notification file
    try {
      const notifPath = path.join(AGENTS_DIR, agentName, '.workflow-notifications', `${runId}_${stepId}.json`);
      if (fs.existsSync(notifPath)) fs.unlinkSync(notifPath);
    } catch {}

    // v1.2: Auto-save agent output to file (since LLM may not call Write tool)
    const outGroup = run.group as string | undefined;
    if (outGroup && output && output.length > 50) {
      try {
        const outDir = path.join(GROUPS_DIR, outGroup, 'outputs');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, `${stepId}.md`);
        atomicWrite(outFile, `# ${stepId}\n\nAgent: ${agentName}\nAction: ${node.step.action || 'execute'}\n\n---\n\n${output}`);
        console.log(`[wf] Auto-saved output to ${outFile}`);
      } catch (e) {
        console.log(`[wf] Failed to auto-save output: ${e}`);
      }
    }

    // Set output and complete
    node.output = output;
    node.status = StepStatus.COMPLETED;
    run.steps.set(stepId, StepStatus.COMPLETED);

    // v1.2: Token economy — auto-reward on step completion (fire-and-forget)
    if (node.step.reward && node.step.reward > 0) {
      import('./token-economy').then(({ reward }) => {
        const isGoodQuality = !isFailed && output.length > 100;
        reward(agentName, node.step.reward!, stepId, isGoodQuality ? 'bonus' : 'normal');
        console.log(`[wf] Rewarded ${agentName} with ${node.step.reward} tokens for ${stepId}`);
      }).catch(e => console.log(`[wf] Failed to reward ${agentName}: ${e}`));
    }

    // Save checkpoint
    const grp = run.group as string | undefined;
    if (grp) saveStepCheckpoint(grp, runId, { stepId, status: 'completed', output, retries: node.retryCount, timestamp: Date.now(), startedAt: node.startedAt, completedAt: Date.now(), durationMs: Date.now() - node.startedAt });

    if (this.bus) this.bus.emit(createEvent(EventType.TASK_COMPLETED, { taskId: runId, stepId, workflow: run.workflowName, agent: node.step.agent, action: node.step.action, output }, 'workflow-engine'));

    // Read task report if exists
    const reportDir = path.join(MIND_DIR, 'agents', agentName, '.task-reports');
    const reportPath = path.join(reportDir, `${stepId}.json`);
    if (fs.existsSync(reportPath)) {
      try {
        const report: TaskReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
        run.taskReports.set(stepId, report);
        fs.unlinkSync(reportPath);
      } catch {}
    }

    // Evaluate routes
    this.evaluatePostStep(runId, node, nodes, output);

    // Continue scheduling
    this.schedule(runId);

    return true;
  }

  /** Evaluate routes, review branching, and continue DAG after step completion */
  private evaluatePostStep(runId: string, node: DagNode, nodes: Map<string, DagNode>, output: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    const sid = node.step.id;

    // Route evaluation
    if (node.routes && node.routes.length > 0) {
      const matchedRoute = node.routes.find(r => this.evalRouteCondition(r.when, output));
      if (matchedRoute && nodes.has(matchedRoute.step)) {
        console.log(`[wf] ${sid} routed to ${matchedRoute.step} (when: ${matchedRoute.when})`);
        for (const depId of node.dependents) {
          const dep = nodes.get(depId);
          if (dep && (dep.status === StepStatus.PENDING || dep.status === StepStatus.BLOCKED)) {
            dep.status = StepStatus.SKIPPED;
            run.steps.set(depId, StepStatus.SKIPPED);
          }
        }
        const target = nodes.get(matchedRoute.step);
        if (target) target.deps = target.deps.filter(d => d !== sid);
        return;
      }
    }

    // Auto-review injection
    if (node.step.reviewer) {
      const reviewId = `${sid}_review`;
      const reviewPrompt = node.step.reviewPrompt || `请审查以下步骤的输出。\n\n步骤: ${node.step.action} (由 ${node.step.agent} 执行)\n输出:\n${output.slice(0, 2000)}\n\n请检查是否正确、完整、符合要求。回复 APPROVED 或 REJECTED 及原因。`;
      const reviewStep: WorkflowStep = { id: reviewId, agent: node.step.reviewer, action: 'review', prompt: reviewPrompt, dependsOn: [sid], priority: 'high' };
      if (!nodes.has(reviewId)) {
        nodes.set(reviewId, { step: reviewStep, deps: [sid], dependents: [], status: StepStatus.PENDING, output: '', error: '', retryCount: 0, maxRetries: 2, rejectCount: 0, maxRejectRetries: 3, timeout: 300000, startedAt: 0, notifiedAt: 0 });
        node.dependents.push(reviewId);
        run.steps.set(reviewId, StepStatus.PENDING);
      }
    } else if (node.step.evaluate) {
      // v1.0: No reviewer — fallback to self-evaluation (heuristic, no AI call)
      const grp = run.group as string | undefined;
      this.storeSelfEvaluation(grp, run.workflowName, node.step, output);
    }

    // Review branching
    if (sid.endsWith('_review')) {
      const originalId = sid.replace(/_review$/, '');
      const originalNode = nodes.get(originalId);
      if (originalNode) {
        // v1.0: Store learning record from review output (reviewer IS the evaluator)
        if (originalNode.step.evaluate) {
          const grp = run.group as string | undefined;
          this.storeReviewEvaluation(grp, run.workflowName, node.step, output, originalNode.output || '');
        }

        if (/REJECTED/i.test(output)) {
          const onReject = originalNode.onReject || originalNode.step.onReject;
          if (onReject === 'fail') {
            originalNode.status = StepStatus.FAILED;
            originalNode.error = `Review rejected: ${output.slice(0, 500)}`;
            run.steps.set(originalId, StepStatus.FAILED);
          } else if (onReject && onReject !== 'retry' && nodes.has(onReject)) {
            const target = nodes.get(onReject)!;
            target.step = { ...target.step, prompt: `${target.step.prompt}\n\n---\n\n【审查反馈 #${originalNode.rejectCount + 1}】${originalId} 被拒绝，原因：${output.slice(0, 1000)}` };
            target.deps = target.deps.filter(d => d !== sid);
          } else if (originalNode.rejectCount < originalNode.maxRejectRetries) {
            originalNode.rejectCount++;
            originalNode.status = StepStatus.PENDING;
            originalNode.output = '';
            // v1.1: Preserve original prompt, append numbered rejection history
            const rawPrompt = originalNode.step.prompt || '';
            const feedbackIdx = rawPrompt.lastIndexOf('\n\n---\n\n【审查反馈');
            const originalPrompt = feedbackIdx > 0 ? rawPrompt.slice(0, feedbackIdx) : rawPrompt;
            const rejectionNum = originalNode.rejectCount;
            const rejectionBlock = `\n\n---\n\n【历次审查反馈】\n${originalNode.rejectCount > 1 ? `第 1-${rejectionNum - 1} 次反馈见上文。\n` : ''}第 ${rejectionNum} 次被拒绝，原因：${output.slice(0, 1000)}\n\n请综合所有反馈，重新提交。注意不要重复犯之前的错误。`;
            originalNode.step = { ...originalNode.step, prompt: originalPrompt + rejectionBlock };
            run.steps.set(originalId, StepStatus.PENDING);
          } else {
            originalNode.status = StepStatus.FAILED;
            originalNode.error = `Review rejected ${originalNode.maxRejectRetries} times`;
            run.steps.set(originalId, StepStatus.FAILED);
          }
        } else if (/APPROVED/i.test(output)) {
          const onApprove = originalNode.onApprove || originalNode.step.onApprove;
          if (onApprove && nodes.has(onApprove)) {
            const target = nodes.get(onApprove);
            if (target) target.deps = target.deps.filter(d => d !== sid);
          }
        }
      }
    }
  }

  // ── v1.0: Learning Records & Quality Evaluation ──────────────────────

  /**
   * Store a learning record from review output.
   * Called when a _review step completes — the reviewer's verdict IS the evaluation.
   * No extra AI call needed.
   */
  /** Consolidated evaluation storage — handles both review and self-evaluation */
  private storeEvaluation(group: string | undefined, workflowName: string, stepId: string, step: WorkflowStep, evaluation: Record<string, unknown>, outputSnippet: string, reviewSnippet?: string): void {
    const evalDir = path.join(MIND_DIR, 'learning');
    if (!fs.existsSync(evalDir)) fs.mkdirSync(evalDir, { recursive: true });

    const record = {
      id: Date.now().toString(36),
      group,
      workflow: workflowName,
      stepId,
      action: step.action,
      agent: step.agent,
      evaluation,
      outputSnippet: outputSnippet.slice(0, 500),
      ...(reviewSnippet ? { reviewSnippet: reviewSnippet.slice(0, 500) } : {}),
      timestamp: new Date().toISOString(),
    };

    const logFile = path.join(evalDir, `learning-${group || 'global'}.jsonl`);
    fs.appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf-8');
    console.log(`[wf] evaluation ${stepId}: total=${evaluation.total}/40 verdict=${evaluation.verdict}`);
  }

  private storeReviewEvaluation(group: string | undefined, workflowName: string, reviewStep: WorkflowStep, reviewOutput: string, originalOutput: string): void {
    const isApproved = /APPROVED/i.test(reviewOutput);
    const isRejected = /REJECTED/i.test(reviewOutput);

    const feedbackText = reviewOutput
      .replace(/^(APPROVED|REJECTED)\s*[:\-]?\s*/i, '')
      .trim()
      .slice(0, 500) || 'No feedback provided';

    const hasDetail = feedbackText.length > 50;
    const baseScore = isApproved ? 8 : isRejected ? 4 : 5;
    const detailBonus = hasDetail ? 1 : 0;

    const evaluation = {
      quality: Math.min(10, baseScore + detailBonus),
      completeness: Math.min(10, baseScore + (isApproved ? 1 : 0)),
      clarity: Math.min(10, baseScore + detailBonus),
      actionability: Math.min(10, baseScore + (isApproved ? 1 : 0)),
      total: 0,
      feedback: feedbackText,
      verdict: isApproved ? 'APPROVED' : isRejected ? 'NEEDS_REVISION' : 'UNKNOWN',
      reviewer: reviewStep.agent,
    };
    evaluation.total = evaluation.quality + evaluation.completeness + evaluation.clarity + evaluation.actionability;

    const originalId = reviewStep.id?.replace(/_review$/, '') || reviewStep.id;
    this.storeEvaluation(group, workflowName, originalId, reviewStep, evaluation, originalOutput, reviewOutput);
  }

  private storeSelfEvaluation(group: string | undefined, workflowName: string, step: WorkflowStep, output: string): void {
    const len = output.length;
    const hasStructure = /^#|^-|^\d+\./m.test(output);
    const hasDetail = len > 200;
    const hasResult = /完成|DONE|SUCCESS|APPROVED/i.test(output);

    const evaluation = {
      quality: Math.min(10, 5 + (hasDetail ? 2 : 0) + (hasResult ? 1 : 0)),
      completeness: Math.min(10, 5 + (hasDetail ? 2 : 0) + (len > 500 ? 1 : 0)),
      clarity: Math.min(10, 5 + (hasStructure ? 2 : 0)),
      actionability: Math.min(10, 5 + (hasResult ? 2 : 0)),
      total: 0,
      feedback: 'Self-evaluation (no reviewer configured)',
      verdict: hasResult ? 'APPROVED' : 'UNKNOWN',
      reviewer: 'self',
    };
    evaluation.total = evaluation.quality + evaluation.completeness + evaluation.clarity + evaluation.actionability;

    this.storeEvaluation(group, workflowName, step.id, step, evaluation, output);
  }

  /**
   * v1.1: Self-improvement — review the entire workflow execution after completion.
   * Analyzes rejections, timing, scores, and writes improvement suggestions.
   * This is the "retrospective" step that helps the system learn.
   */
  private reviewWorkflowExecution(group: string | undefined, run: WorkflowRunRecord, nodes: Map<string, DagNode>): void {
    const evalDir = path.join(MIND_DIR, 'learning');
    if (!fs.existsSync(evalDir)) fs.mkdirSync(evalDir, { recursive: true });

    const durationMs = (run.completedAt || Date.now()) - run.startedAt;
    const stepStats: Array<{
      id: string; agent: string; action: string;
      status: string; durationMs: number; retries: number; rejected: boolean;
    }> = [];

    for (const [id, node] of nodes) {
      if (node.step.type === 'trigger') continue;
      stepStats.push({
        id,
        agent: node.step.agent || 'unknown',
        action: node.step.action || 'execute',
        status: node.status,
        durationMs: node.startedAt ? Date.now() - node.startedAt : 0,
        retries: node.retryCount,
        rejected: node.rejectCount > 0,
      });
    }

    const totalSteps = stepStats.length;
    const completedSteps = stepStats.filter(s => s.status === 'completed').length;
    const failedSteps = stepStats.filter(s => s.status === 'failed').length;
    const rejectedSteps = stepStats.filter(s => s.rejected).length;
    const totalRetries = stepStats.reduce((sum, s) => sum + s.retries, 0);
    const avgDuration = totalSteps > 0 ? Math.round(stepStats.reduce((sum, s) => sum + s.durationMs, 0) / totalSteps) : 0;
    const longestStep = stepStats.sort((a, b) => b.durationMs - a.durationMs)[0];

    // Read existing learning records for trend analysis
    const existingRecords = this.getLearningRecords(group || 'global', 20);
    const prevAvgScore = existingRecords.length > 0
      ? existingRecords.reduce((sum: number, r: any) => sum + (r.evaluation?.total || 0), 0) / existingRecords.length
      : 0;

    // Build improvement suggestions
    const suggestions: string[] = [];
    if (rejectedSteps > 0) {
      suggestions.push(`${rejectedSteps}/${totalSteps} 个步骤被拒绝 — 考虑优化任务描述或分配给更合适的 agent`);
    }
    if (totalRetries > 0) {
      suggestions.push(`共重试 ${totalRetries} 次 — 审查标准可能过严，或任务定义不够明确`);
    }
    if (longestStep && longestStep.durationMs > avgDuration * 2) {
      suggestions.push(`步骤 "${longestStep.id}" 耗时 ${Math.round(longestStep.durationMs / 1000)}s，远超平均 ${Math.round(avgDuration / 1000)}s — 考虑拆分或并行化`);
    }
    if (failedSteps > 0) {
      suggestions.push(`${failedSteps} 个步骤失败 — 检查错误原因，可能需要人工介入`);
    }
    if (rejectedSteps === 0 && failedSteps === 0 && totalRetries === 0) {
      suggestions.push('所有步骤一次通过 — 流程顺畅，可考虑提高质量标准');
    }

    // Store workflow review record
    const reviewRecord = {
      id: Date.now().toString(36),
      type: 'workflow_review',
      group,
      workflow: run.workflowName,
      runId: run.runId,
      summary: {
        totalSteps,
        completedSteps,
        failedSteps,
        rejectedSteps,
        totalRetries,
        avgDurationMs: avgDuration,
        totalDurationMs: durationMs,
        prevAvgScore: Math.round(prevAvgScore),
      },
      stepStats: stepStats.map(s => ({
        id: s.id, agent: s.agent, action: s.action,
        status: s.status, durationMs: s.durationMs, retries: s.retries, rejected: s.rejected,
      })),
      suggestions,
      timestamp: new Date().toISOString(),
    };

    const logFile = path.join(evalDir, `workflow-reviews-${group || 'global'}.jsonl`);
    fs.appendFileSync(logFile, JSON.stringify(reviewRecord) + '\n', 'utf-8');
    console.log(`[wf] Workflow review: ${run.workflowName} — ${completedSteps}/${totalSteps} completed, ${rejectedSteps} rejected, ${suggestions.length} suggestions`);
  }

  /** Get learning records for a group — agents can query this for past outcomes */
  getLearningRecords(group: string, limit = 20): Array<Record<string, unknown>> {
    const logFile = path.join(MIND_DIR, 'learning', `learning-${group}.jsonl`);
    if (!fs.existsSync(logFile)) return [];
    const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-limit);
  }

  /** Get average scores for a group — quick quality overview */
  getQualitySummary(group: string): { avgTotal: number; count: number; approved: number; needsRevision: number } {
    const records = this.getLearningRecords(group, 100);
    if (records.length === 0) return { avgTotal: 0, count: 0, approved: 0, needsRevision: 0 };
    const totals = records.map((r: any) => r.evaluation?.total || 0);
    const approved = records.filter((r: any) => r.evaluation?.verdict === 'APPROVED').length;
    const needsRevision = records.filter((r: any) => r.evaluation?.verdict === 'NEEDS_REVISION').length;
    return {
      avgTotal: Math.round(totals.reduce((a: number, b: number) => a + b, 0) / totals.length),
      count: records.length,
      approved,
      needsRevision,
    };
  }

  // ── v1.2: Timeout Monitoring ────────────────────────────────────────────

  // v0.7: Guard against reentrant schedule() calls
  private scheduling = new Set<string>();

  /** Schedule ready steps in a run (callback model) */
  schedule(runId: string): void {
    if (this.scheduling.has(runId)) return;
    this.scheduling.add(runId);
    try {
    const run = this.runs.get(runId);
    if (!run || run.status !== WorkflowStatus.RUNNING) return;

    // Check abort
    const ac = this.abortControllers.get(runId);
    if (ac?.signal.aborted) {
      run.status = WorkflowStatus.FAILED;
      run.completedAt = Date.now();
      return;
    }

    // ── Re-read blueprint from YAML (live document) ──
    const wfPath = run._yamlPath;
    if (wfPath && fs.existsSync(wfPath)) {
      try {
        const yaml = fs.readFileSync(wfPath, 'utf-8');
        const freshDef = parseWorkflowYaml(yaml);
        // Update run with latest blueprint
        run._wfDef = freshDef;
        // Rebuild DAG nodes from fresh blueprint
        const freshNodes = this.buildDag(freshDef, run);
        this.runNodes.set(runId, freshNodes);
        // Carry over completed/failed status from previous nodes
        const oldNodes = this.runNodes.get(runId);
        if (oldNodes) {
          for (const [id, node] of oldNodes) {
            if (node.status === StepStatus.COMPLETED || node.status === StepStatus.FAILED) {
              freshNodes.get(id)!.status = node.status;
              freshNodes.get(id)!.output = node.output;
            }
          }
        }
      } catch {}
    }

    const nodes = this.runNodes.get(runId);
    if (!nodes) return;

    // Find ready steps — steps whose deps are all completed
    const ready: DagNode[] = [];
    for (const [id, node] of nodes) {
      if (node.status === StepStatus.COMPLETED || node.status === StepStatus.FAILED || node.status === StepStatus.IN_PROGRESS || node.status === StepStatus.WAITING) continue;
      const depsOk = node.deps.every(depId => {
        const dn = nodes.get(depId);
        return dn && (dn.status === StepStatus.COMPLETED || dn.status === StepStatus.SKIPPED);
      });
      if (!depsOk) { node.status = StepStatus.BLOCKED; run.steps.set(id, StepStatus.BLOCKED); continue; }
      ready.push(node);
    }

    // If no ready steps, check if run is done
    if (ready.length === 0) {
      const pending = [...nodes.values()].filter(n => n.status === StepStatus.PENDING || n.status === StepStatus.BLOCKED || n.status === StepStatus.WAITING);
      if (pending.length === 0) {
        let failed = false;
        for (const [, n] of nodes) { if (n.status === StepStatus.FAILED) failed = true; }
        run.status = failed ? WorkflowStatus.FAILED : WorkflowStatus.COMPLETED;
        run.completedAt = Date.now();
        console.log(`[wf] Run ${runId.slice(0, 8)} ${run.status}`);
        const grp = run.group as string | undefined;
        this.reviewWorkflowExecution(grp, run, nodes);
        if (grp) {
          completeRunCheckpoint(grp, runId, run.status === WorkflowStatus.COMPLETED ? 'completed' : 'failed');
          const stepsCompleted = [...(run.steps.values())].filter(s => s === StepStatus.COMPLETED).length;
          const stepsFailed = [...(run.steps.values())].filter(s => s === StepStatus.FAILED).length;
          appendRunHistory(grp, {
            runId, workflowName: run.workflowName, group: grp,
            startedAt: run.startedAt, completedAt: Date.now(),
            status: run.status === WorkflowStatus.COMPLETED ? 'completed' : 'failed',
            stepsTotal: nodes.size, stepsCompleted, stepsFailed,
            compensations: run.compensations.length || 0,
          });
          cleanupCheckpoints(grp);
        }
      return;
    }

    // Execute ready steps — each is independent
    for (const node of ready) {
      this.execNode(runId, node, nodes);
    }
    } finally { this.scheduling.delete(runId); }
  }

  private async execNode(runId: string, node: DagNode, nodes: Map<string, DagNode>): Promise<void> {
    const run = this.runs.get(runId); if (!run) return;
    const sid = node.step.id;
    const phase = phaseForAction(node.step.action || '');

    // ── Trigger steps: auto-complete immediately ──
    if (node.step.type === 'trigger') {
      node.status = StepStatus.COMPLETED;
      node.output = JSON.stringify(node.step.trigger || { type: 'manual' });
      run.steps.set(sid, StepStatus.COMPLETED);
      this.evaluatePostStep(runId, node, nodes, node.output);
      this.schedule(runId);
      return;
    }

    // ── Human approval: pause DAG, wait for POST /workflows/approve ──
    if (node.step.action === 'human_approval') {
      const approvalId = randomUUID().slice(0, 8);
      node.status = StepStatus.IN_PROGRESS; node.output = `AWAITING_HUMAN_APPROVAL approvalId=${approvalId}`;
      run.steps.set(sid, StepStatus.IN_PROGRESS);
      this.pendingApprovals.set(approvalId, { runId, stepId: sid, node, nodes });
      if (this.bus) this.bus.emit(createEvent(EventType.TASK_REVIEW_REQUESTED, {
        taskId: runId, stepId: sid, workflow: run.workflowName,
        agent: node.step.agent, action: 'human_approval',
        approvalId, phase: WorkflowPhase.APPROVAL,
        prompt: node.step.prompt,
      }, 'workflow-engine'));

      // Push notification to browser so the human user sees the approval request
      try {
        const group = run.group || '';
        broadcastWs('wf_approval', {
          runId, approvalId, stepId: sid, group,
          workflow: run.workflowName,
          agent: node.step.agent,
          prompt: (node.step.prompt || '').slice(0, 200),
        });
      } catch {}

      return; // Pause — resume via submitApproval()
    }

    if (this.bus) this.bus.emit(createEvent(EventType.TASK_IN_PROGRESS, { taskId: runId, stepId: sid, workflow: run.workflowName, agent: node.step.agent, action: node.step.action, phase }, 'workflow-engine'));

    // v1.2: Budget check — verify agent has enough balance
    const budgetAgent = node.step.agent || 'unknown';
    if (node.step.budget && node.step.budget > 0) {
      try {
        const { getBalance, withdraw } = await import('./token-economy');
        const balance = await getBalance(budgetAgent);
        if (balance < node.step.budget) {
          console.log(`[wf] ${budgetAgent} insufficient balance for ${sid}: has ${balance}, needs ${node.step.budget}`);
          node.error = `Insufficient balance: ${budgetAgent} has ${balance} tokens, needs ${node.step.budget}`;
          node.status = StepStatus.FAILED;
          run.steps.set(sid, StepStatus.FAILED);
          run.rollbacks.push({ stepId: sid, reason: node.error, timestamp: Date.now() });
          if (this.bus) this.bus.emit(createEvent(EventType.TASK_BLOCKED, { taskId: runId, stepId: sid, workflow: run.workflowName, agent: budgetAgent, reason: node.error, retriesExhausted: true, phase }, 'workflow-engine'));
          return;
        }
        // Deduct budget
        await withdraw(budgetAgent, node.step.budget, sid);
        console.log(`[wf] Deducted ${node.step.budget} tokens from ${budgetAgent} for ${sid}`);
      } catch {}
    }

    const ctx: Record<string, string> = {};
    for (const depId of node.deps) {
      const dn = nodes.get(depId);
      if (dn?.output) ctx[depId] = dn.output;
      // v0.4: Include task report in downstream context
      const report = run.taskReports.get(depId);
      if (report) {
        ctx[`${depId}.status`] = report.status;
        ctx[`${depId}.summary`] = report.summary;
        ctx[`${depId}.details`] = report.details;
      }
    }

    try {
      // v0.5: Callback model — notify agent, wait for callback
      this.notifyAgent(runId, node, nodes, ctx);
      return;  // DAG continues when agent calls workflow_callback
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      node.error = msg;
      node.status = StepStatus.FAILED;
      run.steps.set(sid, StepStatus.FAILED);
      run.rollbacks.push({ stepId: sid, reason: msg, timestamp: Date.now() });
      if (this.bus) this.bus.emit(createEvent(EventType.TASK_BLOCKED, { taskId: runId, stepId: sid, workflow: run.workflowName, agent: node.step.agent, reason: msg, retriesExhausted: true, phase }, 'workflow-engine'));

      // v1.2: Token economy — auto-deduct on step failure
      if (node.step.reward && node.step.reward > 0) {
        const failAgent = node.step.agent || 'unknown';
        try {
          const { penalize } = await import('./token-economy');
          penalize(failAgent, Math.floor(node.step.reward * 0.2), msg.slice(0, 100));
          console.log(`[wf] Penalized ${failAgent} with ${Math.floor(node.step.reward * 0.2)} tokens for failed ${sid}`);
        } catch (err) {
          console.warn(`[workflow-engine] Failed to penalize ${failAgent}:`, err);
        }
      }
    }
  }

  /** v0.5: Route condition evaluator — matches against step output */
  private evalRouteCondition(when: string, output: string): boolean {
    if (!when) return false;
    const out = output.toLowerCase().trim();

    // v1.1: AND/OR compound conditions
    // "condition1 AND condition2" or "condition1 OR condition2"
    const andParts = when.split(/\s+AND\s+/i);
    if (andParts.length > 1) return andParts.every(p => this.evalRouteCondition(p.trim(), output));
    const orParts = when.split(/\s+OR\s+/i);
    if (orParts.length > 1) return orParts.some(p => this.evalRouteCondition(p.trim(), output));

    // v1.1: Score threshold — "score > 30", "score <= 20", "total >= 28"
    const scoreMatch = when.match(/^(score|total)\s*([><=!]+)\s*(\d+)$/i);
    if (scoreMatch) {
      const op = scoreMatch[2];
      const threshold = parseInt(scoreMatch[3]);
      // Extract score from output — look for patterns like "total=28/40" or "28/40" or just a number
      let score = 0;
      const totalMatch = output.match(/(?:total[=:]\s*)?(\d+)\s*\/\s*40/i);
      if (totalMatch) score = parseInt(totalMatch[1]);
      else {
        const numMatch = output.match(/\b(\d{1,2})\b/);
        if (numMatch) score = parseInt(numMatch[1]);
      }
      if (op === '>') return score > threshold;
      if (op === '>=') return score >= threshold;
      if (op === '<') return score < threshold;
      if (op === '<=') return score <= threshold;
      if (op === '==') return score === threshold;
      if (op === '!=') return score !== threshold;
      return false;
    }

    // v1.1: Regex match — "regex:pattern"
    const regexMatch = when.match(/^regex:(.+)$/i);
    if (regexMatch) {
      try { return new RegExp(regexMatch[1], 'i').test(output); } catch { return false; }
    }

    // "output contains X" or just "X"
    const containsMatch = when.match(/^output\s+contains\s+(.+)$/i);
    if (containsMatch) return out.includes(containsMatch[1].toLowerCase().trim());
    // "output == X"
    const eqMatch = when.match(/^output\s*==\s*(.+)$/i);
    if (eqMatch) return out === eqMatch[1].toLowerCase().trim();
    // "output != X"
    const neqMatch = when.match(/^output\s*!=\s*(.+)$/i);
    if (neqMatch) return out !== neqMatch[1].toLowerCase().trim();
    // Shorthand: just "APPROVED" → output contains APPROVED
    return out.includes(when.toLowerCase().trim());
  }

  /** v0.4: Enhanced condition evaluator — supports and_(), or_(), not_(), router() */
  // ── Public helpers ────────────────────────────────────────────────

  /** Find the latest run by workflow name */

  listRuns(): WorkflowRunRecord[] { const seen = new Set<string>(); const out: WorkflowRunRecord[] = []; for (const r of this.runs.values()) { if (!seen.has(r.runId)) { seen.add(r.runId); out.push(r); } } return out; }

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
  /** v0.3 P2: Submit human approval decision and resume DAG execution */
  submitApproval(approvalId: string, decision: 'APPROVED' | 'REJECTED', comment?: string): boolean {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return false;
    this.pendingApprovals.delete(approvalId);

    const { runId, stepId, node, nodes } = pending;
    const run = this.runs.get(runId);
    if (!run) return false;

    // Record human decision as step output
    node.output = `HUMAN_APPROVAL APPROVAL_ID:${approvalId} DECISION:${decision}${comment ? ` COMMENT:${comment}` : ''}`;
    node.status = StepStatus.COMPLETED;
    run.steps.set(stepId, StepStatus.COMPLETED);

    if (this.bus) this.bus.emit(createEvent(EventType.TASK_COMPLETED, {
      taskId: runId, stepId, workflow: run.workflowName,
      agent: node.step.agent, action: 'human_approval',
      output: node.output, decision,
      phase: WorkflowPhase.APPROVAL,
    }, 'workflow-engine'));

    // Notify downstream
    if (node.step.notify) {
      const nl = Array.isArray(node.step.notify) ? node.step.notify : [node.step.notify];
      for (const to of nl) {
        if (this.bus) this.bus.emit(createEvent(EventType.TASK_REVIEW_COMPLETED, {
          taskId: runId, stepId, workflow: run.workflowName,
          from: node.step.agent, to, decision, approvalId,
        }, 'workflow-engine'));
      }
    }

    // Resume DAG: rebuild definition from stored nodes (preserves dynamically injected review steps)
    const steps = [...nodes.values()].map(n => n.step);
    if (steps.length > 0) {
      const def: WorkflowDefinition = { name: run.workflowName, steps };
      // v0.6: removed .then() that prematurely marked COMPLETED — schedule() handles completion via callbacks
      this.executeDag(runId, def).catch((err: Error) => {
        const r = this.runs.get(runId);
        if (r) { r.status = WorkflowStatus.FAILED; r.completedAt = Date.now(); }
        if (this.bus) this.bus.emit(createEvent(EventType.TASK_BLOCKED, { taskId: runId, error: err.message }, 'workflow-engine'));
      });
    }

    return true;
  }

  /** List all pending human approvals */
  listPendingApprovals(): Array<{ approvalId: string; runId: string; stepId: string; agent: string; prompt: string }> {
    return [...this.pendingApprovals.entries()].map(([approvalId, p]) => ({
      approvalId,
      runId: p.runId,
      stepId: p.stepId,
      agent: p.node.step.agent || 'unknown',
      prompt: p.node.step.prompt || '',
    }));
  }

  getRun(idOrName: string): WorkflowRunRecord | undefined {
    // First try direct lookup by runId
    const direct = this.runs.get(idOrName);
    if (direct) return direct;
    // Then try latestRuns lookup by workflow name
    const latestRunId = this.latestRuns.get(idOrName);
    if (latestRunId) return this.runs.get(latestRunId);
    return undefined;
  }
  private getFileMtime(fp: string): number { try { return fs.statSync(fp).mtimeMs; } catch { return 0; } }

  /** v0.3 P2: Check system load before scheduling new work */
  private maxLoad = parseFloat(process.env.MAX_CPU_LOAD || '0.8');

  getSystemLoad(): { load1: number; load5: number; load15: number; cpuCount: number; overloaded: boolean } {
    const [l1, l5, l15] = os.loadavg();
    const cpuCount = os.cpus().length;
    const overloaded = l1 / cpuCount > this.maxLoad;
    return { load1: l1, load5: l5, load15: l15, cpuCount, overloaded };
  }

  tick(): void {
    const { overloaded, load1, cpuCount } = this.getSystemLoad();

    for (const [rid, run] of this.runs) {
      if (run.status !== WorkflowStatus.RUNNING) continue;
      for (const [sid, s] of run.steps) {
        if (s === StepStatus.BLOCKED) {
          const rt = run.stepRetries.get(sid) || 0;
          // v0.3 P2: load-aware — pause retries when system overloaded
          if (overloaded) {
            if (rt === 0) {
              // First-time detection: emit load warning
              run.steps.set(sid, StepStatus.BLOCKED);
              if (this.bus) this.bus.emit(createEvent(EventType.TASK_BLOCKED, {
                taskId: rid, stepId: sid, workflow: run.workflowName,
                reason: `system_load: ${(load1 / cpuCount * 100).toFixed(0)}% CPU (threshold: ${(this.maxLoad * 100).toFixed(0)}%)`,
                phase: WorkflowPhase.COMPLETED,
              }, 'workflow-engine'));
            }
            continue; // skip scheduling while overloaded
          }
          if (rt < 3) {
            run.steps.set(sid, StepStatus.IN_PROGRESS);
            if (this.bus) this.bus.emit(createEvent(EventType.TASK_IN_PROGRESS, {
              taskId: rid, stepId: sid, workflow: run.workflowName,
              action: 'auto-retry', attempt: rt + 1,
            }, 'workflow-engine'));
          }
        }
        // v0.5: Step timeout — if WAITING too long, mark as failed
        if (s === StepStatus.WAITING) {
          const nodes = this.runNodes.get(rid);
          const node = nodes?.get(sid);
          if (node && node.notifiedAt > 0) {
            const elapsed = Date.now() - node.notifiedAt;
            const timeout = node.step.timeout || 300000; // 5min default
            if (elapsed > timeout) {
              console.log(`[wf] Step ${sid} timed out after ${Math.round(elapsed / 1000)}s (run ${rid.slice(0, 8)})`);
              // v0.5: Retry on timeout (same as execution failure)
              if (node.retryCount < node.maxRetries) {
                node.retryCount++;
                node.status = StepStatus.PENDING;
                node.notifiedAt = 0;
                run.steps.set(sid, StepStatus.PENDING);
                console.log(`[wf] ${sid} retry ${node.retryCount}/${node.maxRetries} after timeout`);
              } else {
                node.status = StepStatus.FAILED;
                node.error = `Step timed out after ${Math.round(elapsed / 1000)}s`;
                run.steps.set(sid, StepStatus.FAILED);
                // Trigger compensation if onFailure is set
                if (node.onFailure && nodes && nodes.has(node.onFailure)) {
                  const cn = nodes.get(node.onFailure)!;
                  run.compensations.push(node.onFailure);
                  if (cn.status === StepStatus.PENDING) {
                    this.schedule(rid);
                  }
                }
              }
              // Clean up notification file
              try {
                const notifPath = path.join(AGENTS_DIR, node.step.agent || 'unknown', '.workflow-notifications', `${rid}_${sid}.json`);
                if (fs.existsSync(notifPath)) fs.unlinkSync(notifPath);
              } catch {}
              if (this.bus) this.bus.emit(createEvent(EventType.TASK_BLOCKED, {
                taskId: rid, stepId: sid, workflow: run.workflowName,
                reason: `timeout: ${Math.round(elapsed / 1000)}s`, phase: WorkflowPhase.COMPLETED,
              }, 'workflow-engine'));
              // Continue scheduling to handle downstream
              this.schedule(rid);
            }
          }
        }
      }
    }
  }

  getStats(): { totalRuns: number; activeRuns: number; completedRuns: number; failedRuns: number; totalRetries: number; totalRollbacks: number; totalCompensations: number } {
    const seen = new Set<string>(); let a = 0, c = 0, f = 0, tr = 0, rb = 0, cp = 0;
    for (const [, r] of this.runs) { if (seen.has(r.runId)) continue; seen.add(r.runId); if (r.status === WorkflowStatus.RUNNING) a++; else if (r.status === WorkflowStatus.COMPLETED) c++; else if (r.status === WorkflowStatus.FAILED) f++; for (const v of r.stepRetries.values()) tr += v; rb += r.rollbacks.length; cp += r.compensations.length; }
    return { totalRuns: seen.size, activeRuns: a, completedRuns: c, failedRuns: f, totalRetries: tr, totalRollbacks: rb, totalCompensations: cp };
  }

  /** v0.4: Cancel a running workflow */
  cancel(runId: string): boolean {
    const ac = this.abortControllers.get(runId);
    if (!ac) return false;
    ac.abort();
    this.abortControllers.delete(runId);
    return true;
  }

  /** v0.4: Add a step to a running workflow */
  addStep(group: string, step: WorkflowStep): boolean {
    const run = this.findRunByGroup(group);
    if (!run || run.status !== WorkflowStatus.RUNNING) return false;

    // v1.1: Add to in-memory DAG directly (not just YAML file)
    const nodes = this.runNodes.get(run.runId);
    if (!nodes) return false;

    // Check for duplicate step ID
    if (nodes.has(step.id)) return false;

    // Parse deps — ensure they exist in the DAG
    const deps = (step.dependsOn || []).filter(d => nodes.has(d));
    const node: DagNode = {
      step, deps, dependents: [],
      status: StepStatus.PENDING, output: '', error: '',
      retryCount: 0, maxRetries: step.retry ?? 3,
      rejectCount: 0, maxRejectRetries: step.maxRejectRetries ?? 3,
      onFailure: step.onFailure, onReject: step.onReject, onApprove: step.onApprove,
      routes: step.routes, timeout: step.timeout || 300000, startedAt: 0, notifiedAt: 0,
    };
    nodes.set(step.id, node);

    // Rebuild dependent links
    for (const [id, n] of nodes) {
      n.dependents = [];
      for (const [oid, other] of nodes) {
        if (other.deps.includes(id)) n.dependents.push(oid);
      }
    }

    // Sync to run record
    run.steps.set(step.id, StepStatus.PENDING);

    // Also persist to YAML for recovery
    try {
      const wfPath = path.join(GROUPS_DIR, group, 'workflow.yaml');
      if (fs.existsSync(wfPath)) {
        const raw = fs.readFileSync(wfPath, 'utf-8');
        const def = parseWorkflowYaml(raw);
        if (!def.steps.find(s => s.id === step.id)) {
          def.steps.push(step);
          atomicWrite(wfPath, yaml.dump(def));
        }
      }
    } catch {}

    console.log(`[wf] Added step ${step.id} to running workflow in ${group}`);
    // Trigger scheduling to pick up the new step
    this.schedule(run.runId);
    return true;
  }

  /** v1.1: Delete a step from a running workflow — in-memory DAG + YAML */
  deleteStep(group: string, stepId: string): boolean {
    const run = this.findRunByGroup(group);
    if (!run || run.status !== WorkflowStatus.RUNNING) return false;
    const nodes = this.runNodes.get(run.runId);
    if (!nodes) return false;
    const node = nodes.get(stepId);
    if (!node) return false;
    // Can't delete if step is currently running
    if (node.status === StepStatus.WAITING || node.status === StepStatus.IN_PROGRESS) return false;

    // Remove from DAG
    nodes.delete(stepId);
    // Rebuild dependent links
    for (const [, n] of nodes) {
      n.dependents = n.dependents.filter(d => d !== stepId);
      n.deps = n.deps.filter(d => d !== stepId);
    }
    run.steps.delete(stepId);
    console.log(`[wf] Deleted step ${stepId} from running workflow in ${group}`);
    this.schedule(run.runId);
    return true;
  }

  /** v1.1: Modify a step in a running workflow — in-memory DAG + YAML */
  modifyStep(group: string, stepId: string, changes: Partial<WorkflowStep>): boolean {
    const run = this.findRunByGroup(group);
    if (!run || run.status !== WorkflowStatus.RUNNING) return false;
    const nodes = this.runNodes.get(run.runId);
    if (!nodes) return false;
    const node = nodes.get(stepId);
    if (!node) return false;

    // Apply changes to the step definition
    Object.assign(node.step, changes);
    // Update deps if changed
    if (changes.dependsOn) {
      node.deps = changes.dependsOn.filter(d => nodes.has(d));
      // Rebuild dependent links
      for (const [, n] of nodes) {
        n.dependents = [];
        for (const [oid, other] of nodes) {
          if (other.deps.includes(oid)) n.dependents.push(oid);
        }
      }
    }
    console.log(`[wf] Modified step ${stepId} in running workflow in ${group}`);
    // If step is pending, reschedule to pick up changes
    if (node.status === StepStatus.PENDING) this.schedule(run.runId);
    return true;
  }

  /** v0.4: Find a running workflow by group name */
  private findRunByGroup(group: string): WorkflowRunRecord | undefined {
    // v1.2: Return the LATEST running workflow for this group, not the first
    let latest: WorkflowRunRecord | undefined;
    for (const run of this.runs.values()) {
      if (run.group === group && run.status === WorkflowStatus.RUNNING) {
        if (!latest || run.startedAt > latest.startedAt) latest = run;
      }
    }
    return latest;
  }

  /** v0.4: Get global concurrency limit from settings */
  /** v0.4: Recover incomplete runs — resume from checkpoint */
  recoverCheckpoints(): Array<{ group: string; runId: string; workflowName: string }> {
    const incomplete = findIncompleteRuns();
    const recovered: Array<{ group: string; runId: string; workflowName: string }> = [];

    for (const { group, runId, meta } of incomplete) {
      console.log(`[wf-checkpoint] Resuming: ${meta.workflowName} (${runId.slice(0, 8)}) in ${group}`);

      // Read the workflow definition from disk
      const wfPath = path.join(GROUPS_DIR, group, 'workflow.yaml');
      if (!fs.existsSync(wfPath)) {
        console.log(`[wf-checkpoint] No workflow.yaml in ${group}, marking as failed`);
        completeRunCheckpoint(group, runId, 'failed', 'workflow.yaml not found');
        continue;
      }

      try {
        const raw = fs.readFileSync(wfPath, 'utf-8');
        const def = parseWorkflowYaml(raw);

        // Create a new run record with checkpoint state pre-loaded
        const newRunId = runId; // keep same ID for continuity
        const completedSteps = meta.steps.filter(s => s.status === 'completed');
        const rec: WorkflowRunRecord = {
          runId: newRunId,
          workflowName: def.name,
          startedAt: meta.startedAt,
          status: WorkflowStatus.RUNNING,
          steps: new Map(def.steps.map(s => [s.id, StepStatus.PENDING])),
          stepRetries: new Map(),
          rollbacks: [],
          compensations: [],
          taskReports: new Map(),
        };

        // Mark already-completed steps
        for (const cs of completedSteps) {
          rec.steps.set(cs.stepId, StepStatus.COMPLETED);
        }

        (rec as any)._group = group;
        this.runs.set(newRunId, rec);
        this.latestRuns.set(def.name, newRunId);

        // Resume DAG execution
        // v0.6: removed .then() that prematurely marked COMPLETED — schedule() handles completion via callbacks
        this.executeDag(newRunId, def).catch((err: Error) => {
          const r = this.runs.get(newRunId);
          if (r) { r.status = WorkflowStatus.FAILED; r.completedAt = Date.now(); }
          completeRunCheckpoint(group, newRunId, 'failed');
          console.log(`[wf-checkpoint] Resume failed: ${err.message}`);
        });

        recovered.push({ group, runId: newRunId, workflowName: meta.workflowName });
      } catch (err: unknown) {
        console.log(`[wf-checkpoint] Resume error: ${err instanceof Error ? err.message : String(err)}`);
        completeRunCheckpoint(group, runId, 'failed');
      }
    }
    return recovered;
  }
}

/**
 * Parse workflow_callback calls from agent's text response and execute them.
 * This is a fallback for when MCP tools don't work (SDK binary doesn't register them).
 *
 * Handles patterns like:
 *   workflow_callback(runId="abc", stepId="plan", status="COMPLETED", summary="done")
 *   workflow_callback(runId='abc', stepId='plan', status='APPROVED', summary='looks good', details='...')
 */
