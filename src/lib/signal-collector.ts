/**
 * Signal Collector — Event-driven signal collection for scheduler.
 *
 * Collects signals from file changes (via watcher) and periodic scans.
 * Replaces the per-agent scan in autoRespond with a centralized queue.
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR, GROUPS_DIR, MIND_DIR } from './data-dir';
import { loadState, type AgentState } from './state';
import { getAgentGroups } from './state';
import { getAgentConfig } from './chat';

export interface Signal {
  agent: string;
  type: 'mention' | 'email' | 'group_chat' | 'invitation' | 'heartbeat';
  priority: 'critical' | 'normal' | 'low';
  group?: string;
  from?: string;
  snippet?: string;
  timestamp: number;
}

// Priority levels for scheduling
export const SIGNAL_PRIORITY = {
  critical: 0,  // @mention, human_approval, consensus
  normal: 1,    // new email, group chat
  low: 2,       // heartbeat, periodic scan
} as const;

// v1.2: Priority bucket queue — O(1) insert, O(1) dequeue by priority
const criticalQueue: Signal[] = [];
const normalQueue: Signal[] = [];
const lowQueue: Signal[] = [];
const MAX_QUEUE_SIZE = 100;

// Per-agent last scan time (to avoid duplicate signals)
const lastScanTime = new Map<string, number>();
const SCAN_COOLDOWN = 10_000; // 10s cooldown between scans for same agent

/**
 * Add a signal to the queue (called by watcher or periodic scan)
 */
export function enqueueSignal(signal: Signal): void {
  // Deduplicate: don't add if same agent+type within cooldown
  const lastScan = lastScanTime.get(`${signal.agent}:${signal.type}`) || 0;
  if (Date.now() - lastScan < SCAN_COOLDOWN) return;

  // Don't exceed queue size
  const totalSize = criticalQueue.length + normalQueue.length + lowQueue.length;
  if (totalSize >= MAX_QUEUE_SIZE) {
    // Remove lowest priority signal
    if (lowQueue.length > 0) lowQueue.pop();
    else if (normalQueue.length > 0) normalQueue.pop();
  }

  // O(1) insert into priority bucket
  const priority = signal.priority || 'normal';
  if (priority === 'critical') criticalQueue.push(signal);
  else if (priority === 'low') lowQueue.push(signal);
  else normalQueue.push(signal);

  lastScanTime.set(`${signal.agent}:${signal.type}`, Date.now());
}

/**
 * Get next signal from queue (for scheduler to consume)
 */
export function dequeueSignal(): Signal | undefined {
  // O(1) dequeue from highest priority non-empty bucket
  if (criticalQueue.length > 0) return criticalQueue.shift();
  if (normalQueue.length > 0) return normalQueue.shift();
  if (lowQueue.length > 0) return lowQueue.shift();
  return undefined;
}

/**
 * Peek at queue size
 */
export function queueSize(): number {
  return criticalQueue.length + normalQueue.length + lowQueue.length;
}

/**
 * Scan a single agent for signals (extracted from autoRespond's buildSignal)
 */
export function scanAgentSignals(agentName: string): Signal[] {
  const signals: Signal[] = [];
  const now = Date.now();

  // Check if agent has autoRespond enabled
  const config = getAgentConfig(agentName);
  if (!config) return signals;

  const state = loadState(agentName);

  // Check for @mentions in group chats
  const groups = getAgentGroups(agentName);
  for (const groupName of groups) {
    const chatDir = path.join(GROUPS_DIR, groupName, 'chat');
    if (!fs.existsSync(chatDir)) continue;

    // Check for new messages since last scan
    const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.md'));
    const chatCheck = state.groups?.[groupName]?.chatCheck || 0;
    for (const f of files) {
      try {
        const stat = fs.statSync(path.join(chatDir, f));
        if (stat.mtimeMs <= chatCheck) continue;

        const content = fs.readFileSync(path.join(chatDir, f), 'utf-8');
        if (content.toLowerCase().includes(`@${agentName.toLowerCase()}`)) {
          signals.push({
            agent: agentName,
            type: 'mention',
            priority: 'critical',
            group: groupName,
            from: content.match(/from:\s*(.+)/)?.[1]?.trim() || 'unknown',
            snippet: content.slice(0, 100),
            timestamp: now,
          });
        }
      } catch {}
    }
  }

  // Check for new emails
  const emailDir = path.join(AGENTS_DIR, agentName, 'email');
  if (fs.existsSync(emailDir)) {
    const files = fs.readdirSync(emailDir).filter(f => f.endsWith('.md') && !f.startsWith('sent_'));
    for (const f of files) {
      try {
        const stat = fs.statSync(path.join(emailDir, f));
        if (stat.mtimeMs <= (state.emailCheck || 0)) continue;

        signals.push({
          agent: agentName,
          type: 'email',
          priority: 'normal',
          snippet: f,
          timestamp: now,
        });
      } catch {}
    }
  }

  // Check for workflow notifications
  // v1.2: Use AGENTS_DIR (same path as notifyAgent writes to)
  const notifDir = path.join(AGENTS_DIR, agentName, '.workflow-notifications');
  if (fs.existsSync(notifDir)) {
    const notifFiles = fs.readdirSync(notifDir).filter(f => f.endsWith('.json'));
    for (const f of notifFiles) {
      try {
        const notif = JSON.parse(fs.readFileSync(path.join(notifDir, f), 'utf-8'));
        signals.push({
          agent: agentName,
          type: 'mention', // Treat workflow tasks as high-priority mentions
          priority: 'critical',
          group: 'workflow',
          from: 'workflow-engine',
          snippet: `[工作流任务] runId=${notif.runId} stepId=${notif.stepId}\n${notif.prompt || ''}`,
          timestamp: now,
        });
      } catch {}
    }
  }

  return signals;
}

/**
 * Scan all agents for signals (periodic fallback)
 */
export function scanAllAgents(): Signal[] {
  const signals: Signal[] = [];
  if (!fs.existsSync(AGENTS_DIR)) return signals;

  const agentNames = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name);

  for (const name of agentNames) {
    try {
      signals.push(...scanAgentSignals(name));
    } catch {}
  }

  return signals;
}

/**
 * Process file change event from watcher
 */
export function onFileChange(dir: string): void {
  // v1.2: Extract agent name from path, or scan all agents if base dir
  const match = dir.match(/Agents\/([^/]+)/);
  if (match) {
    // Specific agent directory changed
    const signals = scanAgentSignals(match[1]);
    for (const sig of signals) {
      enqueueSignal(sig);
    }
  } else if (dir.endsWith('Agents') || dir.endsWith('Agents/')) {
    // Base Agents directory changed — scan all agents
    const signals = scanAllAgents();
    for (const sig of signals) {
      enqueueSignal(sig);
    }
  }
}

/**
 * Get queue stats for monitoring
 */
export function getQueueStats(): { size: number; critical: number; normal: number; low: number } {
  return {
    size: criticalQueue.length + normalQueue.length + lowQueue.length,
    critical: criticalQueue.length,
    normal: normalQueue.length,
    low: lowQueue.length,
  };
}
