/**
 * Background agent scheduler
 * Runs every N seconds when the Next.js server is up.
 * Agents with autoRespondToEmail=true are automatically triggered.
 */
import { pollAllAgents } from './auto-respond';
import { emitEvent } from './ws-broadcast';
import { randomUUID } from 'crypto';

let intervalId: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startScheduler(intervalMs = 30000) {
  if (intervalId) return;
  console.log(`[scheduler] Starting background poll every ${intervalMs / 1000}s`);

  // Fire once immediately
  tick();

  intervalId = setInterval(tick, intervalMs);
}

export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[scheduler] Stopped');
  }
}

async function tick() {
  if (running) return;
  running = true;
  const startedAt = Date.now();
  let polledCount = 0;
  let errorCount = 0;

  try {
    const results = await pollAllAgents();
    const triggered = results.filter(r => r.triggered);
    polledCount = results.length;

    if (triggered.length > 0) {
      console.log(`[scheduler] ${triggered.length} agents triggered: ${triggered.map(r => r.agent).join(', ')}`);
    }

    // ── EventBus: poll.result ──
    emitEvent({
      event: 'poll.result',
      payload: {
        agent: 'scheduler',
        duration: Date.now() - startedAt,
        triggered: triggered.length,
        polled: polledCount,
      },
      timestamp: Date.now(),
      source: 'system',
      id: randomUUID(),
    });
  } catch (e: any) {
    errorCount++;
    console.error(`[scheduler] poll error: ${e.message}`);

    // ── EventBus: poll.error ──
    emitEvent({
      event: 'poll.error',
      payload: {
        agent: 'scheduler',
        error: e.message,
        attempt: polledCount,
      },
      timestamp: Date.now(),
      source: 'system',
      id: randomUUID(),
    });
  } finally {
    running = false;
  }
}
