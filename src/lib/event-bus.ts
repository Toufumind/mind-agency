/**
 * Unified Event Bus + Workflow Engine — v0.3
 *
 * Event Bus: 17 event types, filtered subscriptions, UUID dedup, backpressure,
 * Dead Letter Queue + exponential backoff retry.
 *
 * Workflow Engine: YAML-parsed DAG execution, JSONPath condition branching,
 * retry/rollback/compensation, priority scheduling, pluggable StepExecutor.
 *
 * Used by: server.ts (WebSocket on :3001)
 */

import { randomUUID } from 'crypto';
import * as yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';

// ═══════════════════════════════════════════════════════ Event Bus ═════

export enum EventType {
  AGENT_STATUS_CHANGED = 'agent.status.changed', AGENT_ERROR = 'agent.error',
  TASK_CREATED = 'task.created', TASK_ASSIGNED = 'task.assigned',
  TASK_IN_PROGRESS = 'task.in_progress', TASK_COMPLETED = 'task.completed',
  TASK_BLOCKED = 'task.blocked', TASK_REVIEW_REQUESTED = 'task.review_requested',
  TASK_REVIEW_COMPLETED = 'task.review_completed',
  MESSAGE_SENT = 'message.sent', MESSAGE_MENTION = 'message.mention',
  POLL_RESULT = 'poll.result', POLL_ERROR = 'poll.error',
  WS_CONNECT = 'ws.connect', WS_DISCONNECT = 'ws.disconnect',
  EMAIL_RECEIVED = 'email.received', EMAIL_SENT = 'email.sent',
}

export enum EventBusError {
  E_DUPLICATE_SUB = 'E_DUPLICATE_SUB', E_INVALID_FILTER = 'E_INVALID_FILTER',
  E_SUB_NOT_FOUND = 'E_SUB_NOT_FOUND', E_EMIT_FAILED = 'E_EMIT_FAILED',
  E_BACKPRESSURE = 'E_BACKPRESSURE',
}

export interface EventMessage { event: EventType; payload: Record<string, unknown>; timestamp: number; source: string; id: string; }
export interface SubscribeFilter { event?: EventType | EventType[]; agent?: string; taskId?: string; }
export interface SubscribeOptions { scope?: 'events' | 'messages' | 'all'; replay?: boolean; since?: number; }

interface SubEntry { subId: string; filter?: SubscribeFilter; options?: SubscribeOptions; clientId: string; send: (e: EventMessage) => void; backpressureCount: number; createdAt: number; }

export interface DeadLetterEntry { event: EventMessage; failedSubIds: string[]; errors: string[]; deadAt: number; retryCount: number; nextRetryAt: number; maxRetries: number; }

const VALID_EVENT_TYPES = new Set(Object.values(EventType)) as Set<string>;
const MAX_DEDUP = 10000; const BP_LIMIT = 1000; const ORPHAN_MS = 300000; const DLQ_MAX = 1000; const DLQ_SCAN_MS = 30000;
const OUTBOX_DIR = path.join(process.cwd(), '.audit', 'outbox');

export class EventBus {
  private subs = new Map<string, SubEntry>();
  private clientSubs = new Map<string, Set<string>>();
  private dedup = new Set<string>(); private dedupHist: string[] = [];
  private invalidCount = 0;
  private orphanT: ReturnType<typeof setInterval> | null = null;
  private dlqT: ReturnType<typeof setInterval> | null = null;
  private isDev = process.env.NODE_ENV === 'development';
  private deadLetters: DeadLetterEntry[] = [];
  private outboxEnabled = true;

  constructor() { this.startOrphanScan(); this.startDLQScan(); this.replayOutbox(); }

  emit(event: EventMessage): void {
    if (!VALID_EVENT_TYPES.has(event.event)) { this.invalidCount++; if (this.invalidCount >= 5) console.error(`[event-bus] ALERT: ${this.invalidCount} invalid events`); if (this.isDev) throw new Error(`${EventBusError.E_INVALID_FILTER}: "${event.event}"`); return; }
    if (!event.id || event.id.length < 8) event.id = randomUUID();
    if (this.dedup.has(event.id)) return; this.dedup.add(event.id); this.dedupHist.push(event.id);
    while (this.dedupHist.length > MAX_DEDUP) { this.dedup.delete(this.dedupHist.shift()!); }
    if (!event.timestamp) event.timestamp = Date.now();
    if (!event.source) event.source = 'system';
    this.persistToOutbox(event);
    let delivered = 0;
    for (const sub of this.subs.values()) {
      if (!this.matchFilter(event, sub.filter)) continue;
      sub.backpressureCount++; if (sub.backpressureCount > BP_LIMIT) { try { sub.send({ event: EventType.AGENT_ERROR, payload: { code: EventBusError.E_BACKPRESSURE, message: 'Backpressure limit', subId: sub.subId }, timestamp: Date.now(), source: 'system', id: randomUUID() }); } catch {} this.unsubscribe(sub.subId); continue; }
      delivered++; try { sub.send(event); sub.backpressureCount = Math.max(0, sub.backpressureCount - 1); } catch (e: any) { this.enqueueDLQ(event, sub.subId, e.message); try { this.unsubscribe(sub.subId); } catch {} }
    }
  }

  subscribe(filter: SubscribeFilter | undefined, opts: SubscribeOptions | undefined, clientId: string, send: (e: EventMessage) => void): string {
    if (filter?.event) { for (const e of Array.isArray(filter.event) ? filter.event : [filter.event]) { if (!VALID_EVENT_TYPES.has(e)) throw new Error(`${EventBusError.E_INVALID_FILTER}: "${e}"`); } }
    const sid = randomUUID();
    this.subs.set(sid, { subId: sid, filter: filter ? { event: filter.event, agent: filter.agent, taskId: filter.taskId } : undefined, options: { scope: opts?.scope || 'events', replay: opts?.replay, since: opts?.since }, clientId, send, backpressureCount: 0, createdAt: Date.now() });
    if (!this.clientSubs.has(clientId)) this.clientSubs.set(clientId, new Set());
    this.clientSubs.get(clientId)!.add(sid);
    return sid;
  }

  unsubscribe(subId: string): void { const s = this.subs.get(subId); if (!s) throw new Error(`${EventBusError.E_SUB_NOT_FOUND}: "${subId}"`); this.subs.delete(subId); const cs = this.clientSubs.get(s.clientId); if (cs) { cs.delete(subId); if (cs.size === 0) this.clientSubs.delete(s.clientId); } }
  unsubscribeSilent(subId: string): void { try { const s = this.subs.get(subId); if (!s) return; this.subs.delete(subId); const cs = this.clientSubs.get(s.clientId); if (cs) { cs.delete(subId); if (cs.size === 0) this.clientSubs.delete(s.clientId); } } catch {} }

  cleanupClient(clientId: string): number { const sids = this.clientSubs.get(clientId); if (!sids) return 0; let c = 0; for (const sid of sids) { this.subs.delete(sid); c++; } this.clientSubs.delete(clientId); return c; }

  private matchFilter(ev: EventMessage, f?: SubscribeFilter): boolean { if (!f) return true; if (f.event) { const arr = Array.isArray(f.event) ? f.event : [f.event]; if (!arr.includes(ev.event as EventType)) return false; } if (f.agent && ev.source !== f.agent) return false; if (f.taskId && ev.payload?.taskId !== f.taskId) return false; return true; }

  // DLQ
  private enqueueDLQ(event: EventMessage, subId: string, error: string): void {
    const exist = this.deadLetters.find(d => d.event.id === event.id && d.failedSubIds.includes(subId)); if (exist) return;
    const same = this.deadLetters.find(d => d.event.id === event.id);
    if (same) { same.failedSubIds.push(subId); same.errors.push(error); return; }
    this.deadLetters.push({ event: { ...event }, failedSubIds: [subId], errors: [error], deadAt: Date.now(), retryCount: 0, nextRetryAt: Date.now() + 1000, maxRetries: 5 });
    while (this.deadLetters.length > DLQ_MAX) this.deadLetters.shift();
    console.warn(`[event-bus] DLQ: ${event.event} → ${subId.slice(0, 8)}... (${this.deadLetters.length})`);
  }

  retryDeadLetters(): number { const now = Date.now(); let r = 0; for (let i = this.deadLetters.length - 1; i >= 0; i--) { const e = this.deadLetters[i]; if (e.nextRetryAt > now) continue; if (e.retryCount >= e.maxRetries) { for (const sid of e.failedSubIds) { const s = this.subs.get(sid); if (s) try { s.send({ event: EventType.AGENT_ERROR, payload: { code: 'E_DLQ_EXHAUSTED', message: 'DLQ exhausted', originalEventId: e.event.id }, timestamp: Date.now(), source: 'system', id: randomUUID() }); } catch {} } this.deadLetters.splice(i, 1); continue; }
    e.retryCount++; let ok = 0; for (const sid of e.failedSubIds) { const s = this.subs.get(sid); if (!s) { ok++; continue; } try { s.send(e.event); ok++; } catch (err: any) { e.errors.push(`r${e.retryCount}: ${err.message}`); } }
    if (ok === e.failedSubIds.length) this.deadLetters.splice(i, 1); else e.nextRetryAt = Date.now() + Math.min(1000 * Math.pow(2, e.retryCount), 60000); r++; } return r; }
  getDeadLetters(): DeadLetterEntry[] { return [...this.deadLetters]; }
  purgeDeadLetters(): number { const c = this.deadLetters.length; this.deadLetters = []; return c; }
  getDLQStats(): { size: number; oldestMs: number; exhausted: number } { const now = Date.now(); return { size: this.deadLetters.length, oldestMs: this.deadLetters.length > 0 ? now - Math.min(...this.deadLetters.map(d => d.deadAt)) : 0, exhausted: this.deadLetters.filter(d => d.retryCount >= d.maxRetries).length }; }

  private startDLQScan(): void { this.dlqT = setInterval(() => { if (this.deadLetters.length > 0) this.retryDeadLetters(); }, DLQ_SCAN_MS); }
  private startOrphanScan(): void { this.orphanT = setInterval(() => { for (const [sid, s] of this.subs) { if (!this.clientSubs.has(s.clientId)) this.subs.delete(sid); } }, ORPHAN_MS); }

  // ── Outbox persistence v0.3 (P1) ─────────────────────────────────

  /** Persist event to .audit/outbox/YYYY-MM-DD.jsonl before delivery */
  private persistToOutbox(event: EventMessage): void {
    if (!this.outboxEnabled) return;
    try {
      if (!fs.existsSync(OUTBOX_DIR)) fs.mkdirSync(OUTBOX_DIR, { recursive: true });
      const today = new Date().toISOString().slice(0, 10);
      const line = JSON.stringify({ ...event, _outboxAt: Date.now() }) + '\n';
      fs.appendFileSync(path.join(OUTBOX_DIR, `${today}.jsonl`), line, 'utf-8');
    } catch (e: unknown) { console.error(`[event-bus] outbox write failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  /** Replay undelivered events from outbox on startup */
  private replayOutbox(): void {
    if (!fs.existsSync(OUTBOX_DIR)) return;
    const today = new Date().toISOString().slice(0, 10);
    try {
      for (const f of fs.readdirSync(OUTBOX_DIR)) {
        if (!f.endsWith('.jsonl')) continue;
        // Only replay today's events (older ones are already stale)
        if (f.startsWith(today)) {
          const raw = fs.readFileSync(path.join(OUTBOX_DIR, f), 'utf-8');
          const lines = raw.split('\n').filter(Boolean);
          let replayed = 0;
          for (const line of lines.slice(-100)) { // last 100 lines only
            try {
              const ev = JSON.parse(line) as EventMessage;
              if (!this.dedup.has(ev.id)) {
                this.dedup.add(ev.id); this.dedupHist.push(ev.id);
                replayed++;
                // Re-deliver to matching subscribers (existing subs only)
                for (const sub of this.subs.values()) {
                  if (this.matchFilter(ev, sub.filter)) {
                    try { sub.send(ev); } catch { /* sub may be dead */ }
                  }
                }
              }
            } catch { /* corrupt line, skip */ }
          }
          if (replayed > 0) console.log(`[event-bus] outbox replay: ${replayed} events from ${f}`);
        }
      }
      // Clean up outbox files older than 7 days
      const cutoff = Date.now() - 7 * 86400000;
      for (const f of fs.readdirSync(OUTBOX_DIR)) {
        const fp = path.join(OUTBOX_DIR, f);
        try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch {}
      }
    } catch (e: unknown) { console.error(`[event-bus] outbox replay failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  getOutboxStats(): { dir: string; files: number; totalBytes: number } {
    let count = 0, bytes = 0;
    if (fs.existsSync(OUTBOX_DIR)) {
      for (const f of fs.readdirSync(OUTBOX_DIR)) { try { const s = fs.statSync(path.join(OUTBOX_DIR, f)); count++; bytes += s.size; } catch {} }
    }
    return { dir: OUTBOX_DIR, files: count, totalBytes: bytes };
  }

  getStats(): { subscriptions: number; clients: number; dedupSize: number; dlqSize: number; outboxSize: number } { return { subscriptions: this.subs.size, clients: this.clientSubs.size, dedupSize: this.dedup.size, dlqSize: this.deadLetters.length, outboxSize: this.getOutboxStats().files }; }
  hasClient(cid: string): boolean { return this.clientSubs.has(cid) && (this.clientSubs.get(cid)?.size ?? 0) > 0; }
  getClientScope(cid: string): 'events' | 'messages' | 'all' | undefined { const sids = this.clientSubs.get(cid); if (!sids || sids.size === 0) return undefined; const first = sids.values().next().value as string; return this.subs.get(first)?.options?.scope || 'events'; }
  destroy(): void { if (this.orphanT) { clearInterval(this.orphanT); this.orphanT = null; } if (this.dlqT) { clearInterval(this.dlqT); this.dlqT = null; } this.subs.clear(); this.clientSubs.clear(); this.dedup.clear(); this.dedupHist = []; this.deadLetters = []; this.outboxEnabled = false; }
}

export function createEvent(ev: EventType, payload: Record<string, unknown>, source: string): EventMessage { return { event: ev, payload, timestamp: Date.now(), source, id: randomUUID() }; }
export function isValidEventType(t: string): t is EventType { return VALID_EVENT_TYPES.has(t); }

// ═══════════════════════════════════════════════════ Workflow Engine ═══

export enum StepStatus { PENDING = 'pending', BLOCKED = 'blocked', IN_PROGRESS = 'in_progress', COMPLETED = 'completed', SKIPPED = 'skipped', FAILED = 'failed' }
export enum WorkflowStatus { IDLE = 'idle', RUNNING = 'running', COMPLETED = 'completed', FAILED = 'failed' }

export interface WorkflowStep { id: string; agent: string; action: string; prompt: string; notify?: string | string[]; condition?: string; dependsOn?: string[]; timeout?: number; onFailure?: string; retry?: number; retryBackoff?: 'fixed' | 'exponential'; priority?: 'low' | 'normal' | 'high' | 'critical'; }
export interface WorkflowDefinition { name: string; description?: string; steps: WorkflowStep[]; source?: string; }
export interface WorkflowRunRecord { runId: string; workflowName: string; startedAt: number; completedAt?: number; status: WorkflowStatus; steps: Map<string, StepStatus>; stepRetries: Map<string, number>; rollbacks: Array<{ stepId: string; reason: string; timestamp: number }>; compensations: string[]; }

export interface StepExecutor { execute(step: WorkflowStep, context: Record<string, string>): Promise<string>; }

/** Simulated executor — synthetic outputs for dev/testing */
class SimulatedStepExecutor implements StepExecutor {
  async execute(step: WorkflowStep, _ctx: Record<string, string>): Promise<string> {
    const a = step.action.toLowerCase();
    if (a.includes('review')) return `REVIEW_COMPLETE ACTION:${step.action} AGENT:${step.agent} DECISION:APPROVED`;
    if (a.includes('approve')) return `APPROVED ACTION:${step.action} AGENT:${step.agent}`;
    if (a.includes('reject')) return `REJECTED ACTION:${step.action} AGENT:${step.agent}`;
    if (a.includes('deploy')) return `DEPLOYED+PASSED ACTION:${step.action} AGENT:${step.agent}`;
    if (a.includes('verify')) return `VERIFIED ACTION:${step.action} AGENT:${step.agent}`;
    if (a.includes('notify')) return `NOTIFIED ACTION:${step.action} AGENT:${step.agent}`;
    return `COMPLETED ACTION:${step.action} AGENT:${step.agent}`;
  }
}

/** Production executor — calls agent via chatOnce (real AI) */
export class ChatStepExecutor implements StepExecutor {
  async execute(step: WorkflowStep, ctx: Record<string, string>): Promise<string> {
    try {
      const { chatOnce } = await import('./chat.js');
      const ctxStr = Object.entries(ctx).map(([k, v]) => `[${k}] → ${v}`).join('\n');
      const prompt = ctxStr ? `DAG 步骤: ${step.action}\n\n上游输出:\n${ctxStr}\n\n${step.prompt}\n\n简短回复，包含你的决定（如 APPROVED, REJECTED, DEPLOYED 等关键字）。` : step.prompt;
      const { reply } = await chatOnce(step.agent, prompt);
      return reply || `EMPTY_REPLY ACTION:${step.action} AGENT:${step.agent}`;
    } catch (e: unknown) { throw new Error(`ChatStepExecutor failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
}

export function createStepExecutor(): StepExecutor { return process.env.WORKFLOW_EXECUTOR === 'chat' ? new ChatStepExecutor() : new SimulatedStepExecutor(); }

/** Parse workflow YAML — supports snake_case aliases */
export function parseWorkflowYaml(raw: string): WorkflowDefinition {
  const p = yaml.load(raw) as Record<string, any>;
  if (!p || typeof p !== 'object') throw new Error('Invalid workflow YAML');
  const sl = p.steps || p.tasks || [];
  if (!Array.isArray(sl)) throw new Error('YAML "steps" must be an array');
  return { name: p.name || 'unnamed', description: p.description, steps: sl.map((s: any, i: number) => ({ id: s.id || `step_${i}`, agent: s.agent || 'unknown', action: s.action || 'execute', prompt: s.prompt || '', notify: s.notify, condition: s.condition, dependsOn: s.dependsOn || (s.depends_on ? (Array.isArray(s.depends_on) ? s.depends_on : [s.depends_on]) : undefined), timeout: s.timeout || 300000, onFailure: s.on_failure || s.onFailure || undefined, retry: typeof s.retry === 'number' ? Math.min(s.retry, 10) : undefined, retryBackoff: s.retry_backoff || s.retryBackoff || undefined, priority: s.priority || undefined })) };
}

// ── DAG internal types ──────────────────────────────────────────────

interface DagNode { step: WorkflowStep; deps: string[]; dependents: string[]; status: StepStatus; output: string; error: string; retryCount: number; maxRetries: number; onFailure?: string; timeout: number; startedAt: number; }
const PRIORITY: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

// ═══════════════════════════════════════════════════ WorkflowEngine ═══

export class WorkflowEngine {
  private runs = new Map<string, WorkflowRunRecord>();
  private bus?: EventBus;
  private executor: StepExecutor;

  constructor(bus?: EventBus, executor?: StepExecutor) { this.bus = bus; this.executor = executor || createStepExecutor(); }

  /** Execute a workflow — starts DAG asynchronously. Returns run record immediately. */
  execute(def: WorkflowDefinition): WorkflowRunRecord {
    const runId = randomUUID();
    const rec: WorkflowRunRecord = { runId, workflowName: def.name, startedAt: Date.now(), status: WorkflowStatus.RUNNING, steps: new Map(def.steps.map(s => [s.id, StepStatus.PENDING])), stepRetries: new Map(), rollbacks: [], compensations: [] };
    this.runs.set(runId, rec); this.runs.set(def.name, rec);
    if (this.bus) this.bus.emit(createEvent(EventType.TASK_CREATED, { taskId: runId, title: `Workflow: ${def.name}`, stepsTotal: def.steps.length }, 'workflow-engine'));
    this.executeDag(runId, def).then(() => { const r = this.runs.get(runId); if (r && r.status === WorkflowStatus.RUNNING) { r.status = WorkflowStatus.COMPLETED; r.completedAt = Date.now(); } }).catch((err: Error) => { const r = this.runs.get(runId); if (r) { r.status = WorkflowStatus.FAILED; r.completedAt = Date.now(); } if (this.bus) this.bus.emit(createEvent(EventType.TASK_BLOCKED, { taskId: runId, error: err.message }, 'workflow-engine')); });
    return rec;
  }

  // ── Core DAG execution ────────────────────────────────────────────

  private async executeDag(runId: string, def: WorkflowDefinition): Promise<void> {
    const run = this.runs.get(runId); if (!run) return;
    const nodes = new Map<string, DagNode>();
    const compOnly = new Set<string>();

    for (const s of def.steps) { const deps = (s.dependsOn || []).filter(Boolean); if (s.onFailure) compOnly.add(s.onFailure); nodes.set(s.id, { step: s, deps, dependents: [], status: StepStatus.PENDING, output: '', error: '', retryCount: 0, maxRetries: s.retry ?? 3, onFailure: s.onFailure, timeout: s.timeout || 300000, startedAt: 0 }); }
    for (const [id, node] of nodes) { for (const depId of node.deps) { const d = nodes.get(depId); if (d) d.dependents.push(id); } }

    const maxIter = Math.min(nodes.size * 10, 500); let iter = 0;

    while (iter++ < maxIter) {
      if (run.status !== WorkflowStatus.RUNNING) return;
      const ready: DagNode[] = [];

      for (const [id, node] of nodes) {
        if (node.status !== StepStatus.PENDING && node.status !== StepStatus.BLOCKED) continue;
        // Skip compensation-only steps (no deps, referenced via on_failure)
        if (node.deps.length === 0 && compOnly.has(id) && node.status === StepStatus.PENDING) continue;
        const depsOk = node.deps.every(depId => { const dn = nodes.get(depId); return dn && (dn.status === StepStatus.COMPLETED || dn.status === StepStatus.SKIPPED); });
        if (!depsOk) { node.status = StepStatus.BLOCKED; run.steps.set(id, StepStatus.BLOCKED); continue; }
        if (node.step.condition) { const ctx: Record<string, string> = {}; for (const [, n] of nodes) { if (n.output) ctx[n.step.id] = n.output; } if (!this.evalCond(node.step.condition, ctx)) { node.status = StepStatus.SKIPPED; run.steps.set(id, StepStatus.SKIPPED); continue; } }
        ready.push(node);
      }

      if (ready.length === 0) { const pending = [...nodes.values()].filter(n => n.status === StepStatus.PENDING || n.status === StepStatus.BLOCKED); if (pending.length === 0) break; for (const n of pending) { if (n.deps.some(depId => { const dn = nodes.get(depId); return dn && dn.status === StepStatus.FAILED; })) { n.status = StepStatus.SKIPPED; run.steps.set(n.step.id, StepStatus.SKIPPED); } } break; }

      ready.sort((a, b) => (PRIORITY[a.step.priority || 'normal'] ?? 2) - (PRIORITY[b.step.priority || 'normal'] ?? 2));
      await Promise.allSettled(ready.map(n => this.execNode(runId, n, nodes)));
    }

    let failed = false, allDone = true;
    for (const [id, node] of nodes) { run.steps.set(id, node.status); if (node.status === StepStatus.FAILED) failed = true; if (node.status !== StepStatus.COMPLETED && node.status !== StepStatus.SKIPPED) allDone = false; }
    run.status = failed ? WorkflowStatus.FAILED : (allDone ? WorkflowStatus.COMPLETED : WorkflowStatus.RUNNING);
    run.completedAt = Date.now();
  }

  private async execNode(runId: string, node: DagNode, nodes: Map<string, DagNode>): Promise<void> {
    const run = this.runs.get(runId); if (!run) return;
    const sid = node.step.id; node.status = StepStatus.IN_PROGRESS; node.startedAt = Date.now(); run.steps.set(sid, StepStatus.IN_PROGRESS);
    if (this.bus) this.bus.emit(createEvent(EventType.TASK_IN_PROGRESS, { taskId: runId, stepId: sid, workflow: run.workflowName, agent: node.step.agent, action: node.step.action }, 'workflow-engine'));
    const ctx: Record<string, string> = {}; for (const depId of node.deps) { const dn = nodes.get(depId); if (dn?.output) ctx[depId] = dn.output; }

    try {
      const out = await this.executor.execute(node.step, ctx);
      node.output = out; node.status = StepStatus.COMPLETED; run.steps.set(sid, StepStatus.COMPLETED);
      if (this.bus) this.bus.emit(createEvent(EventType.TASK_COMPLETED, { taskId: runId, stepId: sid, workflow: run.workflowName, agent: node.step.agent, action: node.step.action, output: out }, 'workflow-engine'));
      if (node.step.notify) { const nl = Array.isArray(node.step.notify) ? node.step.notify : [node.step.notify]; for (const to of nl) if (this.bus) this.bus.emit(createEvent(EventType.TASK_REVIEW_REQUESTED, { taskId: runId, stepId: sid, workflow: run.workflowName, from: node.step.agent, to, title: `${node.step.action}`, prompt: node.step.prompt.slice(0, 200) }, 'workflow-engine')); }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err); node.error = msg;
      if (node.retryCount < node.maxRetries) { node.retryCount++; run.stepRetries.set(sid, node.retryCount); node.status = StepStatus.PENDING; run.steps.set(sid, StepStatus.PENDING); const bf = node.step.retryBackoff === 'fixed' ? 3000 : Math.pow(2, node.retryCount) * 1000; await new Promise(r => setTimeout(r, bf)); return this.execNode(runId, node, nodes); }
      node.status = StepStatus.FAILED; run.steps.set(sid, StepStatus.FAILED); run.rollbacks.push({ stepId: sid, reason: msg, timestamp: Date.now() });
      if (node.onFailure && nodes.has(node.onFailure)) { const cn = nodes.get(node.onFailure)!; run.compensations.push(node.onFailure); if (cn.status === StepStatus.PENDING) { if (this.bus) this.bus.emit(createEvent(EventType.TASK_IN_PROGRESS, { taskId: runId, stepId: node.onFailure, workflow: run.workflowName, agent: cn.step.agent, action: 'compensation', note: `Triggered by: ${sid}` }, 'workflow-engine')); await this.execNode(runId, cn, nodes); } return; }
      if (this.bus) this.bus.emit(createEvent(EventType.TASK_BLOCKED, { taskId: runId, stepId: sid, workflow: run.workflowName, agent: node.step.agent, reason: msg, retriesExhausted: true }, 'workflow-engine'));
    }
  }

  private evalCond(cond: string, ctx: Record<string, string>): boolean {
    const m = cond.match(/^\$\.(\w+)\.output\s+(contains|==|!=)\s+(.+)$/i);
    if (m) { const [, sid, op, raw] = m; const v = raw.trim().replace(/^['"]|['"]$/g, ''); const out = (ctx[sid] || '').toLowerCase(); const o = op.toLowerCase(); if (o === 'contains') return out.includes(v.toLowerCase()); if (o === '==') return out === v.toLowerCase(); if (o === '!=') return out !== v.toLowerCase(); }
    return Object.prototype.hasOwnProperty.call(ctx, cond);
  }

  // ── Public helpers ────────────────────────────────────────────────

  updateStep(wn: string, sid: string, s: StepStatus) { const r = this.runs.get(wn); if (r) r.steps.set(sid, s); }
  recordRetry(wn: string, sid: string): number { const r = this.runs.get(wn); if (!r) return 0; const n = (r.stepRetries.get(sid) || 0) + 1; r.stepRetries.set(sid, n); return n; }
  recordRollback(wn: string, sid: string, reason: string) { const r = this.runs.get(wn); if (r) r.rollbacks.push({ stepId: sid, reason, timestamp: Date.now() }); }
  recordCompensation(wn: string, sid: string) { const r = this.runs.get(wn); if (!r) return; r.compensations.push(sid); if (this.bus) this.bus.emit(createEvent(EventType.TASK_IN_PROGRESS, { taskId: `dag:${wn}:${sid}`, workflow: wn, step: sid, agent: 'scheduler', action: 'compensation' }, 'workflow-engine')); }
  complete(wn: string) { const r = this.runs.get(wn); if (r) { r.status = WorkflowStatus.COMPLETED; r.completedAt = Date.now(); } }
  fail(wn: string) { const r = this.runs.get(wn); if (r) { r.status = WorkflowStatus.FAILED; r.completedAt = Date.now(); } }
  listRuns(): WorkflowRunRecord[] { const seen = new Set<string>(); const out: WorkflowRunRecord[] = []; for (const r of this.runs.values()) { if (!seen.has(r.runId)) { seen.add(r.runId); out.push(r); } } return out; }
  getRun(idOrName: string): WorkflowRunRecord | undefined { return this.runs.get(idOrName); }

  tick(): void {
    for (const [rid, run] of this.runs) {
      if (run.status !== WorkflowStatus.RUNNING) continue;
      for (const [sid, s] of run.steps) {
        if (s === StepStatus.BLOCKED) { const rt = run.stepRetries.get(sid) || 0; if (rt < 3) { run.steps.set(sid, StepStatus.IN_PROGRESS); if (this.bus) this.bus.emit(createEvent(EventType.TASK_IN_PROGRESS, { taskId: rid, stepId: sid, workflow: run.workflowName, action: 'auto-retry', attempt: rt + 1 }, 'workflow-engine')); } }
      }
    }
  }

  getStats(): { totalRuns: number; activeRuns: number; completedRuns: number; failedRuns: number; totalRetries: number; totalRollbacks: number; totalCompensations: number } {
    const seen = new Set<string>(); let a = 0, c = 0, f = 0, tr = 0, rb = 0, cp = 0;
    for (const [, r] of this.runs) { if (seen.has(r.runId)) continue; seen.add(r.runId); if (r.status === WorkflowStatus.RUNNING) a++; else if (r.status === WorkflowStatus.COMPLETED) c++; else if (r.status === WorkflowStatus.FAILED) f++; tr += r.stepRetries.size; rb += r.rollbacks.length; cp += r.compensations.length; }
    return { totalRuns: seen.size, activeRuns: a, completedRuns: c, failedRuns: f, totalRetries: tr, totalRollbacks: rb, totalCompensations: cp };
  }
}
