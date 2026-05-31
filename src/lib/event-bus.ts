/**
 * Unified Event Bus — v0.2 spec
 *
 * Central event routing for Dashboard, Collab Board, and Workflow automation.
 * 17 event types, filtered subscriptions, UUID dedup, backpressure protection.
 *
 * Used by: server.ts (WebSocket on :3001)
 * Called from: group-server.ts, Next.js API routes (via HTTP POST /events)
 */

import { randomUUID } from 'crypto';

// ── EventType (17 events — v0.2 final) ──────────────────────────────────

export enum EventType {
  // Agent 生命周期
  AGENT_STATUS_CHANGED = 'agent.status.changed',
  AGENT_ERROR = 'agent.error',

  // 任务流转
  TASK_CREATED = 'task.created',
  TASK_ASSIGNED = 'task.assigned',
  TASK_IN_PROGRESS = 'task.in_progress',
  TASK_COMPLETED = 'task.completed',
  TASK_BLOCKED = 'task.blocked',
  TASK_REVIEW_REQUESTED = 'task.review_requested',
  TASK_REVIEW_COMPLETED = 'task.review_completed',

  // 消息
  MESSAGE_SENT = 'message.sent',
  MESSAGE_MENTION = 'message.mention',

  // 轮询 & 健康
  POLL_RESULT = 'poll.result',
  POLL_ERROR = 'poll.error',

  // WebSocket
  WS_CONNECT = 'ws.connect',
  WS_DISCONNECT = 'ws.disconnect',

  // 邮件
  EMAIL_RECEIVED = 'email.received',
  EMAIL_SENT = 'email.sent',
}

// ── EventBusError (5 error codes — v0.2 final) ──────────────────────────

export enum EventBusError {
  E_DUPLICATE_SUB = 'E_DUPLICATE_SUB',
  E_INVALID_FILTER = 'E_INVALID_FILTER',
  E_SUB_NOT_FOUND = 'E_SUB_NOT_FOUND',
  E_EMIT_FAILED = 'E_EMIT_FAILED',
  E_BACKPRESSURE = 'E_BACKPRESSURE',
}

// ── Core interfaces ──────────────────────────────────────────────────────

export interface EventMessage {
  event: EventType;
  payload: Record<string, unknown>;
  timestamp: number; // Unix ms
  source: string; // Agent name | "system"
  id: string; // UUID v4, idempotent dedup
}

export interface SubscribeFilter {
  event?: EventType | EventType[]; // AND with other fields; OR within array
  agent?: string; // filter by source agent
  taskId?: string; // filter by task
}

export interface SubscribeOptions {
  scope?: 'events' | 'messages' | 'all'; // default "events"
  replay?: boolean; // MVP reserved
  since?: number; // MVP reserved, Unix ms
}

interface SubEntry {
  subId: string;
  filter?: SubscribeFilter;
  options?: SubscribeOptions;
  clientId: string;
  send: (event: EventMessage) => void;
  backpressureCount: number; // events queued since last ack
  createdAt: number;
}

// ── Constants ────────────────────────────────────────────────────────────

const VALID_EVENT_TYPES: Set<string> = new Set(Object.values(EventType));
const MAX_DEDUP_IDS = 10000;
const BACKPRESSURE_LIMIT = 1000;
const ORPHAN_SCAN_MS = 5 * 60 * 1000; // 5 min
const INVALID_EVENT_COUNTER_THRESHOLD = 5; // prod alert threshold

// ── EventBus class ───────────────────────────────────────────────────────

export class EventBus {
  private subscriptions = new Map<string, SubEntry>();
  private clientSubs = new Map<string, Set<string>>(); // clientId → Set<subId>
  private dedupSet = new Set<string>();
  private dedupHistory: string[] = []; // sliding window for LRU eviction
  private invalidEventCounter = 0;
  private orphanTimer: ReturnType<typeof setInterval> | null = null;
  private isDev = process.env.NODE_ENV === 'development';

  constructor() {
    this.startOrphanScan();
  }

  // ── emit ─────────────────────────────────────────────────────────────

  /**
   * Publish an event to the bus. All matching subscribers receive it asynchronously.
   *
   * - Invalid EventType → throws E_INVALID_FILTER (dev) or console.error + counter (prod)
   * - Duplicate id → silently dropped (idempotent)
   * - Missing id → auto-generated UUID
   * - No subscribers → console.warn (dev) / counter (prod)
   */
  emit(event: EventMessage): void {
    // Validate EventType
    if (!VALID_EVENT_TYPES.has(event.event)) {
      this.invalidEventCounter++;
      const err = `Invalid EventType: "${event.event}"`;
      if (this.isDev) {
        throw new Error(`${EventBusError.E_INVALID_FILTER}: ${err}`);
      }
      console.error(`[event-bus] ${err}`);
      if (this.invalidEventCounter >= INVALID_EVENT_COUNTER_THRESHOLD) {
        console.error(
          `[event-bus] ALERT: ${this.invalidEventCounter} invalid events received — possible client bug`
        );
      }
      return;
    }

    // Ensure id
    if (!event.id || typeof event.id !== 'string' || event.id.length < 8) {
      event.id = randomUUID();
    }

    // Idempotent dedup
    if (this.dedupSet.has(event.id)) return;
    this.dedupSet.add(event.id);
    this.dedupHistory.push(event.id);
    // LRU eviction
    while (this.dedupHistory.length > MAX_DEDUP_IDS) {
      const old = this.dedupHistory.shift()!;
      this.dedupSet.delete(old);
    }

    // Ensure timestamp
    if (!event.timestamp) {
      event.timestamp = Date.now();
    }

    // Ensure source
    if (!event.source) {
      event.source = 'system';
    }

    // Route to matching subscribers
    let delivered = 0;
    for (const sub of this.subscriptions.values()) {
      if (!this.matchesFilter(event, sub.filter)) continue;

      // Scope check: events-only subs shouldn't get message events routed through event bus
      // (scope routing is handled in server.ts for /broadcast; here we just send)

      // Backpressure check
      sub.backpressureCount++;
      if (sub.backpressureCount > BACKPRESSURE_LIMIT) {
        console.error(
          `[event-bus] E_BACKPRESSURE: sub ${sub.subId} backlog > ${BACKPRESSURE_LIMIT}, disconnecting`
        );
        try {
          sub.send({
            event: EventType.AGENT_ERROR,
            payload: {
              code: EventBusError.E_BACKPRESSURE,
              message: `Backpressure limit ${BACKPRESSURE_LIMIT} exceeded`,
              subId: sub.subId,
            },
            timestamp: Date.now(),
            source: 'system',
            id: randomUUID(),
          });
        } catch {
          /* best-effort */
        }
        this.unsubscribe(sub.subId);
        continue;
      }

      delivered++;

      // Async push (non-blocking)
      try {
        sub.send(event);
        // Reset backpressure on successful send (optimistic)
        sub.backpressureCount = Math.max(0, sub.backpressureCount - 1);
      } catch (e: any) {
        console.error(`[event-bus] send failed for sub ${sub.subId}: ${e.message}`);
        try {
          this.unsubscribe(sub.subId);
        } catch {
          /* already gone */
        }
      }
    }

    if (delivered === 0 && this.isDev) {
      console.warn(`[event-bus] emit ${event.event}: no matching subscribers`);
    }
  }

  // ── subscribe ───────────────────────────────────────────────────────

  /**
   * Subscribe to the event stream. Returns subId (UUID).
   *
   * Filter fields are AND together; event array is OR.
   * Throws E_INVALID_FILTER for unknown EventType values.
   */
  subscribe(
    filter: SubscribeFilter | undefined,
    options: SubscribeOptions | undefined,
    clientId: string,
    send: (event: EventMessage) => void
  ): string {
    // Validate filter events
    if (filter?.event) {
      const events = Array.isArray(filter.event) ? filter.event : [filter.event];
      for (const e of events) {
        if (!VALID_EVENT_TYPES.has(e)) {
          throw new Error(`${EventBusError.E_INVALID_FILTER}: unknown EventType "${e}"`);
        }
      }
    }

    const scope = options?.scope || 'events';

    const subId = randomUUID();
    const entry: SubEntry = {
      subId,
      filter: filter
        ? { event: filter.event, agent: filter.agent, taskId: filter.taskId }
        : undefined,
      options: { scope, replay: options?.replay, since: options?.since },
      clientId,
      send,
      backpressureCount: 0,
      createdAt: Date.now(),
    };

    this.subscriptions.set(subId, entry);

    // Track client → subs mapping
    if (!this.clientSubs.has(clientId)) {
      this.clientSubs.set(clientId, new Set());
    }
    this.clientSubs.get(clientId)!.add(subId);

    return subId;
  }

  // ── unsubscribe ─────────────────────────────────────────────────────

  /**
   * Cancel a subscription. Throws E_SUB_NOT_FOUND for unknown subId.
   * Idempotent for WS-disconnect cleanup (which is normal, not an error).
   */
  unsubscribe(subId: string): void {
    const sub = this.subscriptions.get(subId);
    if (!sub) {
      throw new Error(`${EventBusError.E_SUB_NOT_FOUND}: subId "${subId}" not found`);
    }

    this.subscriptions.delete(subId);
    const clientSet = this.clientSubs.get(sub.clientId);
    if (clientSet) {
      clientSet.delete(subId);
      if (clientSet.size === 0) {
        this.clientSubs.delete(sub.clientId);
      }
    }
  }

  /**
   * Silent unsubscribe — for WS disconnect cleanup where subId may or may not exist.
   * Does NOT throw.
   */
  unsubscribeSilent(subId: string): void {
    try {
      const sub = this.subscriptions.get(subId);
      if (!sub) return;
      this.subscriptions.delete(subId);
      const clientSet = this.clientSubs.get(sub.clientId);
      if (clientSet) {
        clientSet.delete(subId);
        if (clientSet.size === 0) {
          this.clientSubs.delete(sub.clientId);
        }
      }
    } catch {
      /* already gone */
    }
  }

  // ── WS disconnect cleanup ───────────────────────────────────────────

  /** Remove all subscriptions for a disconnected client. */
  cleanupClient(clientId: string): number {
    const subIds = this.clientSubs.get(clientId);
    if (!subIds) return 0;
    let count = 0;
    for (const subId of subIds) {
      this.subscriptions.delete(subId);
      count++;
    }
    this.clientSubs.delete(clientId);
    if (count > 0) {
      console.log(`[event-bus] cleaned up ${count} subs for client ${clientId.slice(0, 8)}...`);
    }
    return count;
  }

  // ── Filter matching ─────────────────────────────────────────────────

  private matchesFilter(event: EventMessage, filter?: SubscribeFilter): boolean {
    if (!filter) return true;

    // Event filter: OR within array, AND with other fields
    if (filter.event) {
      const events = Array.isArray(filter.event) ? filter.event : [filter.event];
      if (!events.includes(event.event as EventType)) return false;
    }

    if (filter.agent && event.source !== filter.agent) return false;

    if (filter.taskId && event.payload?.taskId !== filter.taskId) return false;

    return true;
  }

  // ── Orphan scan ─────────────────────────────────────────────────────

  private startOrphanScan(): void {
    this.orphanTimer = setInterval(() => {
      for (const [subId, sub] of this.subscriptions) {
        // Subscription whose client is no longer tracked → orphan
        if (!this.clientSubs.has(sub.clientId)) {
          this.subscriptions.delete(subId);
          console.warn(`[event-bus] orphan scan: removed sub ${subId.slice(0, 8)}... (client gone)`);
        }
      }
    }, ORPHAN_SCAN_MS);
  }

  // ── Stats ───────────────────────────────────────────────────────────

  getStats(): { subscriptions: number; clients: number; dedupSize: number } {
    return {
      subscriptions: this.subscriptions.size,
      clients: this.clientSubs.size,
      dedupSize: this.dedupSet.size,
    };
  }

  /** Check if a client has any active subscriptions */
  hasClient(clientId: string): boolean {
    return this.clientSubs.has(clientId) && (this.clientSubs.get(clientId)?.size ?? 0) > 0;
  }

  /** Get the scope for a client (derived from their first subscription) */
  getClientScope(clientId: string): 'events' | 'messages' | 'all' | undefined {
    const subs = this.clientSubs.get(clientId);
    if (!subs || subs.size === 0) return undefined;
    const firstSubId = subs.values().next().value as string;
    const sub = this.subscriptions.get(firstSubId);
    return sub?.options?.scope || 'events';
  }

  // ── Cleanup ─────────────────────────────────────────────────────────

  destroy(): void {
    if (this.orphanTimer) {
      clearInterval(this.orphanTimer);
      this.orphanTimer = null;
    }
    this.subscriptions.clear();
    this.clientSubs.clear();
    this.dedupSet.clear();
    this.dedupHistory = [];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Build an EventMessage with auto-generated id and timestamp. */
export function createEvent(
  event: EventType,
  payload: Record<string, unknown>,
  source: string
): EventMessage {
  return {
    event,
    payload,
    timestamp: Date.now(),
    source,
    id: randomUUID(),
  };
}

/** Check if a string is a valid EventType enum value. */
export function isValidEventType(type: string): type is EventType {
  return VALID_EVENT_TYPES.has(type);
}
