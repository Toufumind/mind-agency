/**
 * Background scheduler — watcher-driven + polling fallback.
 *
 * Primary:  fs.watch → debounce 2s → immediate check
 * Fallback: 30s polling
 *
 * Perf: imports at module level (no dynamic import), sequential agent checks.
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

let pollTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
const STARTUP_DELAY = 3000;
const DEFAULT_HEARTBEAT_MS = 120_000; // 2 min default — can be overridden per-agent via config.json

const stats = { triggered: 0, checks: 0, lastCheck: 0 };

export function startScheduler(options?: number | {
  pollIntervalMs?: number; engine?: any; dagIntervalMs?: number;
}): void {
  const opts = typeof options === 'number' ? { pollIntervalMs: options } : (options || {});
  const pollMs = opts.pollIntervalMs ?? 30000;

  startWatcher((dir) => {
    if (running) return;
    console.log(`[scheduler] watcher: ${path.basename(dir)}/`);
    tick('watcher');
  });

  if (pollTimer) clearInterval(pollTimer);
  if (startupTimer) clearTimeout(startupTimer);

  console.log(`[scheduler] watcher + ${pollMs / 1000}s poll (first in ${STARTUP_DELAY / 1000}s)`);

  // Recovery: rescan pending consensus + running workflows on startup
  recoverPendingConsensus();
  import('./workflow-bridge').then(m => m.recoverRunningWorkflows()).catch((err) => { console.error('[scheduler] recoverRunningWorkflows:', err); });

  // v0.4: Load workflow triggers
  try { loadTriggers(); } catch (err) { console.error('[scheduler] Failed to load triggers:', err); }

  startupTimer = setTimeout(() => {
    tick('startup');
    pollTimer = setInterval(() => tick('poll'), pollMs);
    heartbeatTimer = setInterval(() => tickHeartbeat(), DEFAULT_HEARTBEAT_MS);
  }, STARTUP_DELAY);
}

export function stopScheduler(): void {
  stopWatcher();
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
  saveIndex();
  console.log('[scheduler] stopped, index saved');
}

export function getSchedulerStats() {
  return { ...stats, running };
}

async function tick(source: string): Promise<void> {
  if (running) return;
  running = true;
  try {
    stats.checks++;
    stats.lastCheck = Date.now();

    // Refresh chat index + file watchers (catch newly created .md files)
    try { refreshIndex(); } catch (err) { console.error('[scheduler] refreshIndex:', err); }
    try { refreshFileWatchers(); } catch (err) { console.error('[scheduler] refreshFileWatchers:', err); }

    // v0.4: Check workflow triggers (file change, schedule, event)
    try { checkTriggers(); } catch (err) { console.error('[scheduler] checkTriggers:', err); }

    if (!fs.existsSync(AGENTS_DIR)) return;

    const agentNames = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);

    let triggered = 0;
    for (const name of agentNames) {
      try {
        const result = await autoRespond(name);
        if (result.triggered) triggered++;
      } catch (err) { console.error(`[scheduler] autoRespond(${name}):`, err); }
    }

    if (triggered > 0) {
      stats.triggered++;
      console.log(`[scheduler] ${source}: ${triggered} triggered`);
    }

    // Push dashboard refresh so live activity feed updates
    try { broadcastWs('dashboard_refresh', {}); } catch (err) { console.error('[scheduler] broadcastWs:', err); }
  } catch (err) { console.error('[scheduler] tick error:', err); }
  finally { running = false; }
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
