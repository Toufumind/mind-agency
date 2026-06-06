/**
 * Global Scheduler — Priority queue + agent state tracking + dispatch.
 *
 * v0.5: Replaces per-agent polling with global view of agent availability.
 * Features:
 *   - Priority queue (CRITICAL > HIGH > NORMAL > LOW)
 *   - Agent state tracking (idle/busy/blocked)
 *   - Agent capability matching
 *   - CRITICAL signal preemption
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR } from './data-dir';
import { getAgentConfig } from './chat';
import { type Signal, SIGNAL_PRIORITY } from './signal-collector';
import { autoRespond } from './auto-respond';
import { broadcastWs } from './ws-embedded';

// ── Agent State ──────────────────────────────────────────

export interface AgentState {
  name: string;
  status: 'idle' | 'busy' | 'blocked';
  currentTask?: string;
  lastCompletedAt: number;
  consecutiveFailures: number;
  capabilities: string[];
}

const agentStates = new Map<string, AgentState>();

// ── Global Scheduler ─────────────────────────────────────

const MAX_CONSECUTIVE_FAILURES = 3;
const BLOCK_DURATION_MS = 300_000; // 5 min block after 3 consecutive failures

/**
 * Initialize agent states from disk
 */
export function initAgentStates(): void {
  if (!fs.existsSync(AGENTS_DIR)) return;

  const agentNames = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name);

  for (const name of agentNames) {
    if (!agentStates.has(name)) {
      const config = getAgentConfig(name);
      agentStates.set(name, {
        name,
        status: 'idle',
        lastCompletedAt: 0,
        consecutiveFailures: 0,
        capabilities: config?.roles || [],
      });
    }
  }
}

/**
 * Get agent state
 */
export function getAgentState(name: string): AgentState | undefined {
  return agentStates.get(name);
}

/**
 * Mark agent as busy
 */
export function markAgentBusy(name: string, task: string): void {
  const state = agentStates.get(name);
  if (state) {
    state.status = 'busy';
    state.currentTask = task;
  }
}

/**
 * Mark agent as idle (task completed)
 */
export function markAgentIdle(name: string): void {
  const state = agentStates.get(name);
  if (state) {
    state.status = 'idle';
    state.currentTask = undefined;
    state.lastCompletedAt = Date.now();
    state.consecutiveFailures = 0;
  }
}

/**
 * Mark agent as failed
 */
export function markAgentFailed(name: string): void {
  const state = agentStates.get(name);
  if (state) {
    state.consecutiveFailures++;
    if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      state.status = 'blocked';
      console.log(`[global-scheduler] ${name} blocked after ${state.consecutiveFailures} failures`);
      // Notify human
      broadcastWs('agent_blocked', {
        agent: name,
        failures: state.consecutiveFailures,
        message: `${name} 连续失败 ${state.consecutiveFailures} 次，已暂停 ${BLOCK_DURATION_MS / 1000}s`,
      });
    } else {
      state.status = 'idle';
    }
  }
}

/**
 * Check if agent is blocked and should be unblocked
 */
export function checkUnblock(name: string): boolean {
  const state = agentStates.get(name);
  if (!state || state.status !== 'blocked') return false;

  // Auto-unblock after BLOCK_DURATION_MS
  if (Date.now() - state.lastCompletedAt > BLOCK_DURATION_MS) {
    state.status = 'idle';
    state.consecutiveFailures = 0;
    console.log(`[global-scheduler] ${name} unblocked`);
    return true;
  }
  return false;
}

/**
 * Pick best agent for a signal (capability matching + load balancing)
 */
export function pickBestAgent(signal: Signal): AgentState | null {
  initAgentStates();

  const candidates = [...agentStates.values()].filter(s => {
    if (s.status === 'blocked') {
      checkUnblock(s.name);
      if (s.status === 'blocked') return false;
    }
    return s.status === 'idle';
  });

  if (candidates.length === 0) return null;

  // Score agents: prefer matching capabilities, then least recently used
  candidates.sort((a, b) => {
    // Capability match (if signal has group, prefer agents in that group)
    const aMatch = signal.group && a.capabilities.includes(signal.group) ? 1 : 0;
    const bMatch = signal.group && b.capabilities.includes(signal.group) ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;

    // Least recently used
    return a.lastCompletedAt - b.lastCompletedAt;
  });

  return candidates[0];
}

/**
 * Execute a signal on an agent
 */
export async function executeSignal(agent: AgentState, signal: Signal): Promise<boolean> {
  markAgentBusy(agent.name, `${signal.type}:${signal.group || 'global'}`);

  try {
    const result = await autoRespond(agent.name, {
      groupName: signal.group,
      force: signal.priority === 'critical',
    });
    markAgentIdle(agent.name);
    return result.triggered;
  } catch (err) {
    markAgentFailed(agent.name);
    return false;
  }
}

/**
 * Get global scheduler stats
 */
export function getGlobalStats(): {
  agents: { name: string; status: string; failures: number }[];
  queue: { size: number };
} {
  initAgentStates();
  const agents = [...agentStates.values()].map(s => ({
    name: s.name,
    status: s.status,
    failures: s.consecutiveFailures,
  }));
  return { agents, queue: { size: 0 } };
}
