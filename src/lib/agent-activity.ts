/**
 * Agent Activity Tracker — lightweight in-memory state per agent.
 *
 * Updated from:
 *   - auto-respond.ts → sets 'processing' when agent starts/finishes auto-respond
 *   - chat.ts        → sets 'chatting' when a chat stream is active
 *   - workflow engine → sets 'working' during workflow step execution
 *
 * Exposed via heartbeat API so the frontend sidebar can show real-time status.
 *
 * v1.3: Uses AgentProxy for unified state management.
 */

import { getAgentRegistry } from './agent-registry';
import { AgentStatus, AgentActivity } from './agent-proxy';

// Re-export types for backward compatibility
export type { AgentStatus, AgentActivity };

/** Set or update an agent's current activity. */
export function setActivity(agent: string, status: AgentStatus, detail: string): void {
  const proxy = getAgentRegistry().getOrCreate(agent);
  proxy.setStatus(status, detail);
}

/** Reset an agent to idle (e.g. after auto-respond finishes). */
export function clearActivity(agent: string): void {
  const proxy = getAgentRegistry().getOrCreate(agent);
  proxy.clearStatus();
}

/** Get a snapshot of all agent activities. */
export function getAllActivities(): Record<string, AgentActivity> {
  const result: Record<string, AgentActivity> = {};
  const registry = getAgentRegistry();

  // Include agents from registry
  for (const proxy of registry.getAll()) {
    result[proxy.name] = proxy.activity;
  }

  return result;
}

/** Get a single agent's activity (defaults to idle if unknown). */
export function getActivity(agent: string): AgentActivity {
  const proxy = getAgentRegistry().getOrCreate(agent);
  return proxy.activity;
}

/**
 * Clean up stale entries (agents that haven't updated in > 5 min).
 * Call periodically from the scheduler.
 */
export function pruneStaleActivities(): void {
  const cutoff = Date.now() - 300_000;
  const registry = getAgentRegistry();

  for (const proxy of registry.getAll()) {
    if (proxy.activity.updatedAt < cutoff && proxy.activity.status !== 'idle') {
      proxy.clearStatus();
    }
  }
}
