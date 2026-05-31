/**
 * Background agent scheduler
 * Runs every N seconds when the Next.js server is up.
 * Agents with autoRespondToEmail=true are automatically triggered.
 */
import { pollAllAgents } from './auto-respond';

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
  try {
    const results = await pollAllAgents();
    const triggered = results.filter(r => r.triggered);
    if (triggered.length > 0) {
      console.log(`[scheduler] ${triggered.length} agents triggered: ${triggered.map(r => r.agent).join(', ')}`);
    }
  } catch (e: any) {
    console.error(`[scheduler] poll error: ${e.message}`);
  } finally {
    running = false;
  }
}
