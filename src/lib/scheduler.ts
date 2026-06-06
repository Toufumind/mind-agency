/**
 * Background scheduler — event-driven + polling fallback.
 *
 * Primary:  fs.watch → signal collector → priority queue → dispatch
 * Fallback: 5min polling (only for watcher-missed changes)
 *
 * v0.5: Event-driven signals, priority queue, global dispatch.
 */

import path from 'path';
import fs from 'fs';
import { startWatcher, stopWatcher, refreshFileWatchers } from './watcher';
import { AGENTS_DIR } from './data-dir';
import { autoRespond, agentHeartbeat } from './auto-respond';
import { refreshIndex, saveIndex } from './chat-index';
import { recoverPendingConsensus } from './consensus';
import { broadcastWs } from './ws-embedded';
import { loadTriggers, checkTriggers } from './workflow-trigger';
import { onFileChange, dequeueSignal, queueSize, getQueueStats, scanAllAgents, type Signal } from './signal-collector';

let pollTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let dispatchTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let dispatching = false;
const STARTUP_DELAY = 3000;
const FALLBACK_POLL_MS = 300_000; // 5min fallback polling (reduced from 30s)
const DISPATCH_INTERVAL = 1_000; // Check queue every 1s
const DEFAULT_HEARTBEAT_MS = 120_000; // 2 min default

const stats = { triggered: 0, checks: 0, dispatched: 0, lastCheck: 0 };

export function startScheduler(options?: number | {
  pollIntervalMs?: number; engine?: any; dagIntervalMs?: number;
}): void {
  const opts = typeof options === 'number' ? { pollIntervalMs: options } : (options || {});

  // Watcher triggers signal collection (not direct tick)
  startWatcher((dir) => {
    console.log(`[scheduler] watcher: ${path.basename(dir)}/`);
    onFileChange(dir);
  });

  if (pollTimer) clearInterval(pollTimer);
  if (dispatchTimer) clearInterval(dispatchTimer);
  if (startupTimer) clearTimeout(startupTimer);

  console.log(`[scheduler] event-driven + ${FALLBACK_POLL_MS / 1000}s fallback (first in ${STARTUP_DELAY / 1000}s)`);

  // Recovery: rescan pending consensus + running workflows on startup
  recoverPendingConsensus();
  import('./workflow-bridge').then(m => m.recoverRunningWorkflows()).catch((err) => { console.error('[scheduler] recoverRunningWorkflows:', err); });

  // Load workflow triggers
  try { loadTriggers(); } catch (err) { console.error('[scheduler] Failed to load triggers:', err); }

  startupTimer = setTimeout(() => {
    // Initial scan
    fallbackScan('startup');
    // Fallback polling (5min, only for watcher-missed changes)
    pollTimer = setInterval(() => fallbackScan('fallback'), FALLBACK_POLL_MS);
    // Dispatch queue every 1s
    dispatchTimer = setInterval(() => dispatch(), DISPATCH_INTERVAL);
    // Heartbeat
    heartbeatTimer = setInterval(() => tickHeartbeat(), DEFAULT_HEARTBEAT_MS);
  }, STARTUP_DELAY);
}

export function stopScheduler(): void {
  stopWatcher();
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (dispatchTimer) { clearInterval(dispatchTimer); dispatchTimer = null; }
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
  saveIndex();
  console.log('[scheduler] stopped, index saved');
}

export function getSchedulerStats() {
  return { ...stats, running, queue: getQueueStats() };
}

/**
 * Fallback scan — only for watcher-missed changes (5min interval)
 */
async function fallbackScan(source: string): Promise<void> {
  if (running) return;
  running = true;
  try {
    stats.checks++;
    stats.lastCheck = Date.now();

    // Refresh chat index + file watchers
    try { refreshIndex(); } catch (err) { console.error('[scheduler] refreshIndex:', err); }
    try { refreshFileWatchers(); } catch (err) { console.error('[scheduler] refreshFileWatchers:', err); }

    // Check workflow triggers
    try { checkTriggers(); } catch (err) { console.error('[scheduler] checkTriggers:', err); }

    // Scan all agents for signals and enqueue
    const signals = scanAllAgents();
    for (const sig of signals) {
      const { enqueueSignal } = await import('./signal-collector');
      enqueueSignal(sig);
    }

    if (signals.length > 0) {
      console.log(`[scheduler] ${source}: ${signals.length} signals enqueued`);
    }
  } catch (err) { console.error('[scheduler] fallbackScan error:', err); }
  finally { running = false; }
}

/**
 * Dispatch — process signals from queue
 */
async function dispatch(): Promise<void> {
  if (dispatching) return;
  dispatching = true;
  try {
    let dispatched = 0;
    while (queueSize() > 0) {
      const signal = dequeueSignal();
      if (!signal) break;

      try {
        const result = await autoRespond(signal.agent, {
          groupName: signal.group,
          force: signal.priority === 'critical',
        });
        if (result.triggered) {
          dispatched++;
          stats.dispatched++;
        }
      } catch (err) {
        console.error(`[scheduler] dispatch(${signal.agent}):`, err);
      }
    }

    if (dispatched > 0) {
      stats.triggered++;
      console.log(`[scheduler] dispatched ${dispatched} signals`);
      try { broadcastWs('dashboard_refresh', {}); } catch {}
    }
  } catch (err) { console.error('[scheduler] dispatch error:', err); }
  finally { dispatching = false; }
}

async function tickHeartbeat(): Promise<void> {
  if (!fs.existsSync(AGENTS_DIR)) return;

  const agentNames = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name);

  for (const name of agentNames) {
    try {
      // Read per-agent heartbeat interval from config.json, fall back to default
      let interval = DEFAULT_HEARTBEAT_MS;
      const cfgPath = path.join(AGENTS_DIR, name, 'config.json');
      if (fs.existsSync(cfgPath)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
          if (cfg.heartbeatIntervalMs) interval = cfg.heartbeatIntervalMs;
        } catch (err) { console.error(`[scheduler] heartbeat config(${name}):`, err); }
      }

      await agentHeartbeat(name, interval);
    } catch (err) { console.error(`[scheduler] heartbeat(${name}):`, err); }
  }
}
