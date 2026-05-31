/**
 * Background agent scheduler — v0.3
 *
 * Dual-loop: poll (agent triggers every N seconds) + DAG tick (workflow progress).
 * Backward-compatible: startScheduler(30000) works; startScheduler({ engine, ... }) for DAG.
 */

import { pollAllAgents } from './auto-respond';
import { emitEvent } from './ws-broadcast';
import { randomUUID } from 'crypto';
import type { WorkflowEngine } from './event-bus';

let pollTid: ReturnType<typeof setInterval> | null = null;
let dagTid: ReturnType<typeof setInterval> | null = null;
let pollRunning = false; let dagRunning = false;
let pollMs = 30000; let dagMs = 10000;

export function startScheduler(
  opts?: number | { pollIntervalMs?: number; dagIntervalMs?: number; engine?: WorkflowEngine }
): void {
  if (pollTid) return;
  if (typeof opts === 'number') { pollMs = opts; }
  else if (opts) { pollMs = opts.pollIntervalMs || 30000; dagMs = opts.dagIntervalMs || 10000; }
  console.log(`[scheduler] v0.3 — poll ${pollMs / 1000}s, dag ${dagMs / 1000}s`);
  tickPoll(); pollTid = setInterval(tickPoll, pollMs);
  const eng = (typeof opts === 'object' ? opts?.engine : undefined);
  if (eng) { tickDag(eng); dagTid = setInterval(() => tickDag(eng), dagMs); }
}

export function stopScheduler(): void {
  if (pollTid) { clearInterval(pollTid); pollTid = null; }
  if (dagTid) { clearInterval(dagTid); dagTid = null; }
  console.log('[scheduler] Stopped');
}

export function getSchedulerStats() {
  return { pollMode: pollTid !== null, dagMode: dagTid !== null, pollIntervalMs: pollMs, dagIntervalMs: dagMs };
}

async function tickPoll(): Promise<void> {
  if (pollRunning) return; pollRunning = true; const t0 = Date.now();
  try {
    const results = await pollAllAgents(); const tri = results.filter(r => r.triggered);
    if (tri.length > 0) console.log(`[scheduler] ${tri.length} agents: ${tri.map(r => r.agent).join(', ')}`);
    emitEvent({ event: 'poll.result', payload: { agent: 'scheduler', duration: Date.now() - t0, triggered: tri.length, polled: results.length }, timestamp: Date.now(), source: 'system', id: randomUUID() });
  } catch (e: unknown) { console.error(`[scheduler] poll error: ${e instanceof Error ? e.message : String(e)}`); }
  finally { pollRunning = false; }
}

async function tickDag(engine: WorkflowEngine): Promise<void> {
  if (dagRunning) return; dagRunning = true;
  try { engine.tick(); } catch (e: unknown) { console.error(`[scheduler] dag error: ${e instanceof Error ? e.message : String(e)}`); }
  finally { dagRunning = false; }
}

export function getSchedulerStats() {
  return {
    pollIntervalMs, dagIntervalMs,
    pollMode: pollTid !== null,
    dagMode: dagTid !== null,
  };
}

export { pollAllAgents } from './auto-respond';
