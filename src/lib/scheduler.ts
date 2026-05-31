/**
 * Background agent scheduler — v0.3
 *
 * Dual-loop: poll (agent triggers every N seconds) + DAG tick (workflow progress).
 * v0.3 auto-trigger: DAG loop scans Groups subdirs for workflow.yaml files
 * and auto-executes any workflow that does not have an active run.
 *
 * Backward-compatible: accepts number (poll ms) or options object with engine.
 */

import { pollAllAgents } from './auto-respond';
import { emitEvent } from './ws-broadcast';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { WorkflowEngine, WorkflowDefinition } from './event-bus';
import { parseWorkflowYaml } from './event-bus';

let pollTid: ReturnType<typeof setInterval> | null = null;
let dagTid: ReturnType<typeof setInterval> | null = null;
let pollRunning = false; let dagRunning = false;
let pollMs = 30000; let dagMs = 10000;
let engine: WorkflowEngine | undefined;
/** Track last-triggered YAML mtime — only re-trigger if file changed */
const lastMtime = new Map<string, number>();

export function startScheduler(
  opts?: number | { pollIntervalMs?: number; dagIntervalMs?: number; engine?: WorkflowEngine }
): void {
  if (pollTid) return;
  if (typeof opts === 'number') { pollMs = opts; }
  else if (opts) { pollMs = opts.pollIntervalMs ?? 30000; dagMs = opts.dagIntervalMs ?? 10000; }
  console.log(`[scheduler] v0.3 — poll ${pollMs / 1000}s, dag ${dagMs / 1000}s`);
  tickPoll(); pollTid = setInterval(tickPoll, pollMs);
  engine = (typeof opts === 'object' ? opts?.engine : undefined);
  if (engine) { tickDag(); dagTid = setInterval(tickDag, dagMs); }
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

/** v0.3: Auto-trigger workflows from Groups subdir workflow.yaml files */
async function tickDag(): Promise<void> {
  if (dagRunning || !engine) return; dagRunning = true;
  try {
    // Progress existing runs (retries, timeouts)
    engine.tick();

    // Scan and auto-trigger new workflows
    const gd = path.join(process.cwd(), 'Groups');
    if (!fs.existsSync(gd)) return;
    for (const e of fs.readdirSync(gd, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const yp = path.join(gd, e.name, 'workflow.yaml');
      if (!fs.existsSync(yp)) continue;
      try {
        const st = fs.statSync(yp);
        const mtime = st.mtimeMs;
        const prev = lastMtime.get(yp) || 0;
        if (mtime === prev) continue; // YAML unchanged — skip
        lastMtime.set(yp, mtime);

        const raw = fs.readFileSync(yp, 'utf-8');
        const def = parseWorkflowYaml(raw);
        if (!def?.name || !def.steps?.length) continue;

        // Check if workflow has an active run — skip if still running
        const active = engine.listRuns().some(
          r => r.workflowName === def.name && r.status === 'running'
        );
        if (active) continue;

        console.log(`[scheduler] auto-trigger workflow: "${def.name}" (${def.steps.length} steps)`);
        engine.execute(def);
      } catch (er: unknown) { /* parse failure, skip */ }
    }
  } catch (e: unknown) { console.error(`[scheduler] dag error: ${e instanceof Error ? e.message : String(e)}`); }
  finally { dagRunning = false; }
}

export { pollAllAgents } from './auto-respond';
