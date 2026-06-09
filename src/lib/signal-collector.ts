/**
 * Signal Collector — Event-driven signal collection for scheduler.
 *
 * Collects signals from file changes (via watcher) and periodic scans.
 * Each agent has its own priority queue to avoid starvation.
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

// v1.3: Per-agent priority queues
const agentQueues = new Map<string, {
  critical: Signal[];
  normal: Signal[];
  low: Signal[];
}>();

const MAX_QUEUE_PER_AGENT = 50;

// Per-agent last scan time (to avoid duplicate signals)
const lastScanTime = new Map<string, number>();
const SCAN_COOLDOWN = 10_000; // 10s cooldown between scans for same agent

function getAgentQueue(agent: string) {
  let q = agentQueues.get(agent);
  if (!q) {
    q = { critical: [], normal: [], low: [] };
    agentQueues.set(agent, q);
  }
  return q;
}

/**
 * Add a signal to the agent's queue
 */
export function enqueueSignal(signal: Signal): void {
  // Deduplicate: don't add if same agent+type within cooldown
  const lastScan = lastScanTime.get(`${signal.agent}:${signal.type}`) || 0;
  if (Date.now() - lastScan < SCAN_COOLDOWN) return;

  const q = getAgentQueue(signal.agent);
  const totalSize = q.critical.length + q.normal.length + q.low.length;

  // Don't exceed queue size per agent
  if (totalSize >= MAX_QUEUE_PER_AGENT) {
    if (q.low.length > 0) q.low.pop();
    else if (q.normal.length > 0) q.normal.pop();
  }

  // Insert into priority bucket
  const priority = signal.priority || 'normal';
  if (priority === 'critical') q.critical.push(signal);
  else if (priority === 'low') q.low.push(signal);
  else q.normal.push(signal);

  lastScanTime.set(`${signal.agent}:${signal.type}`, Date.now());
}

/**
 * Get next signal for a specific agent
 */
export function dequeueSignalFor(agent: string): Signal | undefined {
  const q = agentQueues.get(agent);
  if (!q) return undefined;

  if (q.critical.length > 0) return q.critical.shift();
  if (q.normal.length > 0) return q.normal.shift();
  if (q.low.length > 0) return q.low.shift();
  return undefined;
}

/**
 * Get next signal from any agent (round-robin)
 */
export function dequeueSignal(): Signal | undefined {
  // Round-robin through agents
  for (const [agent, q] of agentQueues) {
    if (q.critical.length > 0) return q.critical.shift();
    if (q.normal.length > 0) return q.normal.shift();
    if (q.low.length > 0) return q.low.shift();
  }
  return undefined;
}

/**
 * Get total queue size across all agents
 */
export function queueSize(): number {
  let total = 0;
  for (const q of agentQueues.values()) {
    total += q.critical.length + q.normal.length + q.low.length;
  }
  return total;
}

/**
 * Get queue size for a specific agent
 */
export function agentQueueSize(agent: string): number {
  const q = agentQueues.get(agent);
  if (!q) return 0;
  return q.critical.length + q.normal.length + q.low.length;
}

/**
 * Check if a specific agent has pending signals
 */
export function hasPendingSignals(agent: string): boolean {
  return agentQueueSize(agent) > 0;
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
  const agentMatch = dir.match(/Agents\/([^/]+)/);
  if (agentMatch) {
    // Specific agent directory changed
    const signals = scanAgentSignals(agentMatch[1]);
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

  // v1.2: Handle Groups/ directory changes — scan all agents in affected group
  const groupMatch = dir.match(/Groups\/([^/]+)/);
  if (groupMatch) {
    const groupName = groupMatch[1];
    // Scan all agents that might have new mentions in this group
    const signals = scanAllAgents();
    for (const sig of signals) {
      if (sig.group === groupName || sig.type === 'mention') {
        enqueueSignal(sig);
      }
    }
  } else if (dir.endsWith('Groups') || dir.endsWith('Groups/')) {
    // Base Groups directory changed — scan all agents
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
  let size = 0, critical = 0, normal = 0, low = 0;
  for (const q of agentQueues.values()) {
    size += q.critical.length + q.normal.length + q.low.length;
    critical += q.critical.length;
    normal += q.normal.length;
    low += q.low.length;
  }
  return { size, critical, normal, low };
}
