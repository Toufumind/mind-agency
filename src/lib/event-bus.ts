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
import os from 'os';
import { AUDIT_DIR, GROUPS_DIR, MIND_DIR } from './data-dir';
import { broadcastWs } from './ws-embedded';
import { enqueueTask, completeTask } from './task-queue';
import { checkToolPermission } from './permission-engine';
import {
  saveRunMeta, saveStepCheckpoint, completeRunCheckpoint,
  appendRunHistory, findIncompleteRuns, cleanupCheckpoints,
  type StepCheckpoint,
} from './workflow-checkpoint';

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

/** v0.3 P1: Workflow phase tags — MetaGPT-style stage markers for pipeline visualization */
export enum WorkflowPhase {
  REQUIREMENT = 'requirement', DESIGN = 'design', REVIEW = 'review',
  APPROVAL = 'approval', DEPLOY = 'deploy', VERIFY = 'verify',
  COMPENSATION = 'compensation', COMPLETED = 'completed',
}

/** Map step action to workflow phase */
function phaseForAction(action?: string): WorkflowPhase {
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
const OUTBOX_DIR = path.join(AUDIT_DIR, 'outbox');

export class EventBus {
  private subs = new Map<string, SubEntry>();
  private clientSubs = new Map<string, Set<string>>();
  private dedup = new Map<string, null>(); // v0.3.1: unified dedup — replaces Set + dedupHist to fix redundant storage and sync bugs
  private invalidCount = 0;
  private orphanT: ReturnType<typeof setInterval> | null = null;
  private dlqT: ReturnType<typeof setInterval> | null = null;
  private isDev = process.env.NODE_ENV === 'development';
  private deadLetters: DeadLetterEntry[] = [];
  private outboxEnabled = true;

  constructor() { this.startOrphanScan(); this.startDLQScan(); this.replayOutbox();
    // Cleanup timers on process exit
    const cleanup = () => { this.destroy(); };
    process.on('exit', cleanup);
    // Note: SIGINT/SIGTERM handled by server.ts entry point — not here to avoid double-handler conflict
  }

  emit(event: EventMessage): void {
    if (!VALID_EVENT_TYPES.has(event.event)) { this.invalidCount++; if (this.invalidCount >= 5) console.error(`[event-bus] ALERT: ${this.invalidCount} invalid events`); if (this.isDev) throw new Error(`${EventBusError.E_INVALID_FILTER}: "${event.event}"`); return; }
    if (!event.id || event.id.length < 8) event.id = randomUUID();
    // v0.3.1: Map-based dedup — O(1) lookup + FIFO eviction in one structure
    // Fixes: redundant Set+array storage, stale UUIDs after slice, Set not synced during compact
    if (this.dedup.has(event.id)) return;
    this.dedup.set(event.id, null);
    // v0.3.1: Evict oldest entries when over limit (Map preserves insertion order)
    if (this.dedup.size > MAX_DEDUP) {
      const toEvict = this.dedup.size - Math.floor(MAX_DEDUP / 2);
      let evicted = 0;
      for (const key of this.dedup.keys()) {
        if (evicted >= toEvict) break;
        this.dedup.delete(key);
        evicted++;
      }
    }
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

  /**
   * Persist event to .audit/outbox/YYYY-MM-DD.jsonl before delivery.
   *
   * Atomicity note: appendFileSync is NOT atomic in the POSIX sense, but for
   * small writes (< 4KB, which a single JSON line always is) on modern OS
   * kernels (Linux ext4, NTFS, APFS), the write lands in a single disk
   * sector and is effectively atomic. This is the same guarantee that tools
   * like jq and Node.js itself rely on for JSONL append patterns. If the
   * process crashes mid-write, at most the last line may be truncated, and
   * replayOutbox() already skips corrupt lines via JSON.parse catch.
   *
   * The try-catch below handles OS-level failures (disk full, permission
   * denied, directory deleted) gracefully -- outbox persistence is
   * best-effort and must never crash the event bus.
   */
  private persistToOutbox(event: EventMessage): void {
    if (!this.outboxEnabled) return;
    try {
      if (!fs.existsSync(OUTBOX_DIR)) fs.mkdirSync(OUTBOX_DIR, { recursive: true });
      const today = new Date().toISOString().slice(0, 10);
      const line = JSON.stringify({ ...event, _outboxAt: Date.now() }) + '\n';
      fs.appendFileSync(path.join(OUTBOX_DIR, `${today}.jsonl`), line, 'utf-8');
    } catch (e: unknown) {
      // Graceful degradation: log and continue. Outbox is best-effort;
      // event delivery to live subscribers still proceeds regardless.
      console.error(`[event-bus] outbox write failed (continuing): ${e instanceof Error ? e.message : String(e)}`);
    }
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
                this.dedup.set(ev.id, null);
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
  destroy(): void { if (this.orphanT) { clearInterval(this.orphanT); this.orphanT = null; } if (this.dlqT) { clearInterval(this.dlqT); this.dlqT = null; } this.subs.clear(); this.clientSubs.clear(); this.dedup.clear(); this.deadLetters = []; this.outboxEnabled = false; }
}

function createEvent(ev: EventType, payload: Record<string, unknown>, source: string): EventMessage { return { event: ev, payload, timestamp: Date.now(), source, id: randomUUID() }; }

// ── v0.4: Singleton EventBus + in-process Pub/Sub ─────────────────────

let _singleton: EventBus | null = null;

/** Get or create the global EventBus singleton */
export function getEventBus(): EventBus {
  if (!_singleton) _singleton = new EventBus();
  return _singleton;
}

type EventHandler = (event: EventMessage) => void;
const _handlers = new Map<EventType, Set<EventHandler>>();

function onEvent(type: EventType, handler: EventHandler): () => void {
  if (!_handlers.has(type)) _handlers.set(type, new Set());
  _handlers.get(type)!.add(handler);
  // Auto-route via the singleton's subscribe
  const bus = getEventBus();
  const subId = bus.subscribe({ event: type }, { scope: 'events' }, `inproc:${type}`, (msg) => {
    handler(msg);
  });
  return () => {
    _handlers.get(type)?.delete(handler);
    try { bus.unsubscribe(subId); } catch { /* sub may already be removed */ }
  };
}

function emitEvent(type: EventType, payload: Record<string, unknown>, source: string): void {
  getEventBus().emit({ event: type, payload, timestamp: Date.now(), source, id: randomUUID() });
}

// ═══════════════════════════════════════════════════ Workflow Engine ═══

export enum StepStatus { PENDING = 'pending', BLOCKED = 'blocked', IN_PROGRESS = 'in_progress', WAITING = 'waiting', COMPLETED = 'completed', SKIPPED = 'skipped', FAILED = 'failed' }
export enum WorkflowStatus { IDLE = 'idle', RUNNING = 'running', COMPLETED = 'completed', FAILED = 'failed' }

export interface WorkflowStepRoute { step: string; when: string; }
export interface WorkflowStep { id: string; type?: 'step' | 'trigger'; agent?: string; action?: string; prompt?: string; trigger?: WorkflowTrigger; notify?: string | string[]; condition?: string; dependsOn?: string[]; routes?: WorkflowStepRoute[]; timeout?: number; onFailure?: string; onReject?: string; onApprove?: string; maxRejectRetries?: number; retry?: number; retryBackoff?: 'fixed' | 'exponential'; priority?: 'low' | 'normal' | 'high' | 'critical'; reviewer?: string; reviewPrompt?: string; }
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
export interface WorkflowRunRecord { runId: string; workflowName: string; startedAt: number; completedAt?: number; status: WorkflowStatus; steps: Map<string, StepStatus>; stepRetries: Map<string, number>; rollbacks: Array<{ stepId: string; reason: string; timestamp: number }>; compensations: string[]; taskReports: Map<string, TaskReport>; }

export interface StepExecutor { execute(step: WorkflowStep, context: Record<string, string>): Promise<string>; }


function parseReviewFindings(output: string): Array<{ file: string; line: number; desc: string; fix: string }> {
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
    // v0.4: Build context from upstream steps (including task reports)
    const ctxStr = Object.entries(ctx)
      .map(([k, v]) => {
        if (k.includes('.')) {
          // Task report field (e.g., "step1.status", "step1.summary")
          return `[${k}]: ${v}`;
        }
        return `[上游步骤 ${k} 的输出]\n${v.slice(0, 500)}`;
      })
      .join('\n\n');

    // v0.4: Step is a notification — agent does the work and reports via task tool
    const promptSuffix = `\n\n---\n\n【重要】完成任务后，请用 task 工具报告结果：
task(action="report", step_id="${step.id}", status="APPROVED 或 REJECTED", summary="你的结果摘要", details="详细说明")
这一步的结果会被工作流引擎读取。`;

    const prompt = ctxStr
      ? `[工作流上下文]\n${ctxStr}\n\n---\n\n你的任务:\n${step.prompt}${promptSuffix}`
      : `${step.prompt}${promptSuffix}`;

    // ── Permission check — every step execution goes through the engine ──
    const agent = step.agent || 'unknown';
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
        const stream = createChatStream(agent, prompt, undefined, models[i]);
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

interface DagNode { step: WorkflowStep; deps: string[]; dependents: string[]; status: StepStatus; output: string; error: string; retryCount: number; maxRetries: number; rejectCount: number; maxRejectRetries: number; onFailure?: string; onReject?: string; onApprove?: string; routes?: WorkflowStepRoute[]; timeout: number; startedAt: number; notifiedAt: number; }
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
    if (group) (rec as any)._group = group;
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
      this.evictOldRuns();
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

    const cyclePath = detectCycle(nodes);
    if (cyclePath) {
      throw new Error(`Circular dependency detected in workflow DAG: ${cyclePath}`);
    }

    // ── Start scheduling (callback model) ──
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
    const callbackInstr = `\n\n---\n\n【工作流回调】完成后请用 workflow_callback 报告结果：
workflow_callback(runId="${runId}", stepId="${sid}", status="APPROVED 或 REJECTED 或 COMPLETED 或 FAILED", summary="结果摘要", details="详细说明")
这一步的结果会被工作流引擎读取并决定下一步。`;

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

    // Also persist notification to agent's chat so it can be picked up
    try {
      const notifDir = path.join(MIND_DIR, 'agents', agent, '.workflow-notifications');
      if (!fs.existsSync(notifDir)) fs.mkdirSync(notifDir, { recursive: true });
      const notifPath = path.join(notifDir, `${runId}_${sid}.json`);
      const { atomicWrite } = require('./atomic');
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
    if (!run || run.status !== WorkflowStatus.RUNNING) return false;
    const nodes = this.runNodes.get(runId);
    if (!nodes) return false;
    const node = nodes.get(stepId);
    if (!node || node.status !== StepStatus.WAITING) return false;

    console.log(`[wf] Callback: ${stepId} ← ${output.slice(0, 100)} (run ${runId.slice(0, 8)})`);

    // Complete task in agent's task queue
    const agentName = node.step.agent || 'unknown';
    const isFailed = /FAILED|ERROR/i.test(output);
    completeTask(agentName, runId, stepId, output.slice(0, 500), isFailed ? 'failed' : 'completed');

    // Clean up notification file
    try {
      const notifPath = path.join(MIND_DIR, 'agents', agentName, '.workflow-notifications', `${runId}_${stepId}.json`);
      if (fs.existsSync(notifPath)) fs.unlinkSync(notifPath);
    } catch {}

    // Set output and complete
    node.output = output;
    node.status = StepStatus.COMPLETED;
    run.steps.set(stepId, StepStatus.COMPLETED);

    // Save checkpoint
    const grp = (run as any)._group as string | undefined;
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
    }

    // Review branching
    if (sid.endsWith('_review')) {
      const originalId = sid.replace(/_review$/, '');
      const originalNode = nodes.get(originalId);
      if (originalNode) {
        if (/REJECTED/i.test(output)) {
          const onReject = originalNode.onReject || originalNode.step.onReject;
          if (onReject === 'fail') {
            originalNode.status = StepStatus.FAILED;
            originalNode.error = `Review rejected: ${output.slice(0, 500)}`;
            run.steps.set(originalId, StepStatus.FAILED);
          } else if (onReject && onReject !== 'retry' && nodes.has(onReject)) {
            const target = nodes.get(onReject)!;
            target.step = { ...target.step, prompt: `${target.step.prompt}\n\n---\n\n【审查反馈】${originalId} 被拒绝，原因：${output.slice(0, 1000)}` };
            target.deps = target.deps.filter(d => d !== sid);
          } else if (originalNode.rejectCount < originalNode.maxRejectRetries) {
            originalNode.rejectCount++;
            originalNode.status = StepStatus.PENDING;
            originalNode.output = '';
            originalNode.step = { ...originalNode.step, prompt: `${originalNode.step.prompt}\n\n---\n\n【审查反馈】上次提交被拒绝，原因：${output.slice(0, 1000)}\n请根据反馈修改后重新提交。` };
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

  // v0.7: Guard against reentrant schedule() calls
  private scheduling = new Set<string>();

  /** Schedule ready steps in a run (callback model) */
  schedule(runId: string): void {
    if (this.scheduling.has(runId)) return; // Prevent reentrant scheduling
    this.scheduling.add(runId);
    try {
    const run = this.runs.get(runId);
    if (!run || run.status !== WorkflowStatus.RUNNING) return;
    const nodes = this.runNodes.get(runId);
    if (!nodes) return;

    // Check abort
    const ac = this.abortControllers.get(runId);
    if (ac?.signal.aborted) {
      run.status = WorkflowStatus.FAILED;
      run.completedAt = Date.now();
      return;
    }

    // Find ready steps
    const ready: DagNode[] = [];
    for (const [id, node] of nodes) {
      if (node.status !== StepStatus.PENDING && node.status !== StepStatus.BLOCKED) continue;
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
        // All done
        let failed = false;
        for (const [, n] of nodes) { if (n.status === StepStatus.FAILED) failed = true; }
        run.status = failed ? WorkflowStatus.FAILED : WorkflowStatus.COMPLETED;
        run.completedAt = Date.now();
        console.log(`[wf] Run ${runId.slice(0, 8)} ${run.status}`);
        // Save history and cleanup
        const grp = (run as any)._group as string | undefined;
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
        // v0.8: Don't evict immediately — let runs persist for status queries
        // this.evictOldRuns();
      }
      return;
    }

    // v0.7: Execute ready steps with concurrency control
    ready.sort((a, b) => (PRIORITY[a.step.priority || 'normal'] ?? 2) - (PRIORITY[b.step.priority || 'normal'] ?? 2));
    const MAX_CONCURRENT = 5; // Limit concurrent step executions
    let running = 0;
    for (const node of ready) {
      if (running >= MAX_CONCURRENT) break; // Respect concurrency limit
      running++;
      this.execNode(runId, node, nodes).finally(() => { running--; });
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
        const group = (run as any)._group || '';
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
    }
  }

  /** v0.5: Route condition evaluator — matches against step output */
  private evalRouteCondition(when: string, output: string): boolean {
    if (!when) return false;
    const out = output.toLowerCase().trim();
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
  private evalCond(cond: string, ctx: Record<string, string>): boolean {
    // ── Compound operators (v0.4) ──
    // and_($.a.output contains X, $.b.output == Y)
    const andMatch = cond.match(/^and_\((.+)\)$/i);
    if (andMatch) {
      const args = this.splitConditionArgs(andMatch[1]);
      return args.every(a => this.evalCond(a.trim(), ctx));
    }
    // or_($.a.output contains X, $.b.output == Y)
    const orMatch = cond.match(/^or_\((.+)\)$/i);
    if (orMatch) {
      const args = this.splitConditionArgs(orMatch[1]);
      return args.some(a => this.evalCond(a.trim(), ctx));
    }
    // not_($.step.output contains ERROR)
    const notMatch = cond.match(/^not_\((.+)\)$/i);
    if (notMatch) {
      return !this.evalCond(notMatch[1].trim(), ctx);
    }
    // router($.step.output, { "APPROVED": "deploy_step", "REJECTED": "rollback_step" })
    // Returns true if the current step output matches any key (used for branching)
    const routerMatch = cond.match(/^router\(\s*\$\.(\w+)\.output\s*,\s*\{(.+)\}\s*\)$/i);
    if (routerMatch) {
      const [, sid, routesStr] = routerMatch;
      const out = (ctx[sid] || '').toLowerCase().trim();
      // Parse route keys
      const keys = routesStr.split(',').map(k => {
        const m = k.match(/"(.+?)"/);
        return m ? m[1].toLowerCase() : k.trim().toLowerCase();
      });
      return keys.some(k => out.includes(k));
    }

    // ── Single expression (original) ──
    const m = cond.match(/^\$\.(\w+)\.output\s+(contains|==|!=)\s+(.+)$/i);
    if (m) { const [, sid, op, raw] = m; const v = raw.trim().replace(/^['"]|['"]$/g, ''); const out = (ctx[sid] || '').toLowerCase(); const o = op.toLowerCase(); if (o === 'contains') return out.includes(v.toLowerCase()); if (o === '==') return out === v.toLowerCase(); if (o === '!=') return out !== v.toLowerCase(); }
    return Object.prototype.hasOwnProperty.call(ctx, cond);
  }

  /** Split condition arguments respecting nested parentheses */
  private splitConditionArgs(argsStr: string): string[] {
    const args: string[] = [];
    let depth = 0, current = '';
    for (const ch of argsStr) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { args.push(current); current = ''; }
      else current += ch;
    }
    if (current.trim()) args.push(current);
    return args;
  }

  // ── Public helpers ────────────────────────────────────────────────

  /** Find the latest run by workflow name */
  private findRunByName(wn: string): WorkflowRunRecord | undefined {
    let latest: WorkflowRunRecord | undefined;
    for (const r of this.runs.values()) {
      if (r.workflowName === wn) {
        if (!latest || r.startedAt > latest.startedAt) latest = r;
      }
    }
    return latest;
  }

  /** Evict old completed/failed runs — keep last `keep` per workflow name */
  private evictOldRuns(keep: number = 100): void {
    const byName = new Map<string, WorkflowRunRecord[]>();
    for (const r of this.runs.values()) {
      if (!byName.has(r.workflowName)) byName.set(r.workflowName, []);
      byName.get(r.workflowName)!.push(r);
    }
    for (const [, runs] of byName) {
      // Sort by startedAt ascending (oldest first)
      runs.sort((a, b) => a.startedAt - b.startedAt);
      // Remove finished runs beyond the keep limit
      const finished = runs.filter(r => r.status !== WorkflowStatus.RUNNING);
      while (finished.length > keep) {
        const oldest = finished.shift()!;
        this.runs.delete(oldest.runId);
        this.abortControllers.delete(oldest.runId);
        this.runNodes.delete(oldest.runId);
      }
    }
  }

  updateStep(wn: string, sid: string, s: StepStatus) { const r = this.findRunByName(wn); if (r) r.steps.set(sid, s); }
  recordRetry(wn: string, sid: string): number { const r = this.findRunByName(wn); if (!r) return 0; const n = (r.stepRetries.get(sid) || 0) + 1; r.stepRetries.set(sid, n); return n; }
  recordRollback(wn: string, sid: string, reason: string) { const r = this.findRunByName(wn); if (r) r.rollbacks.push({ stepId: sid, reason, timestamp: Date.now() }); }
  recordCompensation(wn: string, sid: string) { const r = this.findRunByName(wn); if (!r) return; r.compensations.push(sid); if (this.bus) this.bus.emit(createEvent(EventType.TASK_IN_PROGRESS, { taskId: `dag:${wn}:${sid}`, workflow: wn, step: sid, agent: 'scheduler', action: 'compensation' }, 'workflow-engine')); }
  complete(wn: string) { const r = this.findRunByName(wn); if (r) { r.status = WorkflowStatus.COMPLETED; r.completedAt = Date.now(); } }
  fail(wn: string) { const r = this.findRunByName(wn); if (r) { r.status = WorkflowStatus.FAILED; r.completedAt = Date.now(); } }
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
                const notifPath = path.join(MIND_DIR, 'agents', node.step.agent || 'unknown', '.workflow-notifications', `${rid}_${sid}.json`);
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
    for (const [, r] of this.runs) { if (seen.has(r.runId)) continue; seen.add(r.runId); if (r.status === WorkflowStatus.RUNNING) a++; else if (r.status === WorkflowStatus.COMPLETED) c++; else if (r.status === WorkflowStatus.FAILED) f++; tr += r.stepRetries.size; rb += r.rollbacks.length; cp += r.compensations.length; }
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
    // Store in pending additions — will be picked up by hot-reload
    const wfPath = path.join(GROUPS_DIR, group, 'workflow.yaml');
    if (!fs.existsSync(wfPath)) return false;
    try {
      const raw = fs.readFileSync(wfPath, 'utf-8');
      const def = parseWorkflowYaml(raw);
      def.steps.push(step);
      const { atomicWrite } = require('./atomic');
      atomicWrite(wfPath, yaml.dump(def));
      console.log(`[wf] Added step ${step.id} to ${group} workflow`);
      return true;
    } catch { return false; }
  }

  /** v0.4: Delete a step from a running workflow */
  deleteStep(group: string, stepId: string): boolean {
    const run = this.findRunByGroup(group);
    if (!run || run.status !== WorkflowStatus.RUNNING) return false;
    const wfPath = path.join(GROUPS_DIR, group, 'workflow.yaml');
    if (!fs.existsSync(wfPath)) return false;
    try {
      const raw = fs.readFileSync(wfPath, 'utf-8');
      const def = parseWorkflowYaml(raw);
      const idx = def.steps.findIndex(s => s.id === stepId);
      if (idx === -1) return false;
      def.steps.splice(idx, 1);
      const { atomicWrite } = require('./atomic');
      atomicWrite(wfPath, yaml.dump(def));
      console.log(`[wf] Deleted step ${stepId} from ${group} workflow`);
      return true;
    } catch { return false; }
  }

  /** v0.4: Modify a step in a running workflow */
  modifyStep(group: string, stepId: string, changes: Partial<WorkflowStep>): boolean {
    const run = this.findRunByGroup(group);
    if (!run || run.status !== WorkflowStatus.RUNNING) return false;
    const wfPath = path.join(GROUPS_DIR, group, 'workflow.yaml');
    if (!fs.existsSync(wfPath)) return false;
    try {
      const raw = fs.readFileSync(wfPath, 'utf-8');
      const def = parseWorkflowYaml(raw);
      const step = def.steps.find(s => s.id === stepId);
      if (!step) return false;
      Object.assign(step, changes);
      const { atomicWrite } = require('./atomic');
      atomicWrite(wfPath, yaml.dump(def));
      console.log(`[wf] Modified step ${stepId} in ${group} workflow`);
      return true;
    } catch { return false; }
  }

  /** v0.4: Find a running workflow by group name */
  private findRunByGroup(group: string): WorkflowRunRecord | undefined {
    for (const run of this.runs.values()) {
      if ((run as any)._group === group && run.status === WorkflowStatus.RUNNING) {
        return run;
      }
    }
    return undefined;
  }

  /** v0.4: Get global concurrency limit from settings */
  private getGlobalConcurrency(): number {
    try {
      const settingsPath = path.join(process.env.MIND_DATA_DIR || process.cwd(), '.mind', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        return settings.maxConcurrentTasks || 5;
      }
    } catch {}
    return 5; // default
  }

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
export function parseAndExecuteCallbacks(agentName: string, text: string): void {
  if (!text) return;

  // Match workflow_callback(...) calls in the text
  const callbackRegex = /workflow_callback\s*\(\s*([^)]+)\)/gi;
  let match;

  while ((match = callbackRegex.exec(text)) !== null) {
    try {
      const argsStr = match[1];
      const args: Record<string, string> = {};

      // Parse key="value" or key='value' pairs
      const argRegex = /(\w+)\s*=\s*["']([^"']*)["']/g;
      let argMatch;
      while ((argMatch = argRegex.exec(argsStr)) !== null) {
        args[argMatch[1].toLowerCase()] = argMatch[2];
      }

      const runId = args.runid || args.runId;
      const stepId = args.stepid || args.stepId;
      const status = (args.status || 'COMPLETED').toUpperCase();
      const summary = args.summary || args.result || text.slice(0, 200);
      const details = args.details || '';

      if (!runId || !stepId) {
        console.log(`[wf-text-callback] Missing runId or stepId in: ${match[0].slice(0, 100)}`);
        continue;
      }

      console.log(`[wf-text-callback] ${agentName}: ${stepId} ← ${status} (run ${runId.slice(0, 8)})`);

      // Find the engine instance and call callback
      const engineInstance = (global as any).__workflowEngine as WorkflowEngine | undefined;
      if (engineInstance) {
        const output = `${status}: ${summary}${details ? '\n' + details : ''}`;
        engineInstance.callback(runId, stepId, output);
      } else {
        console.log(`[wf-text-callback] No workflow engine instance available`);
      }
    } catch (e) {
      console.log(`[wf-text-callback] Parse error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
