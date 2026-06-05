/**
 * Agent Activity Tracker — lightweight in-memory state per agent.
 *
 * Updated from:
 *   - auto-respond.ts → sets 'processing' when agent starts/finishes auto-respond
 *   - chat.ts        → sets 'chatting' when a chat stream is active
 *   - workflow engine → sets 'working' during workflow step execution
 *
 * Exposed via heartbeat API so the frontend sidebar can show real-time status.
 */

export type AgentStatus = 'idle' | 'processing' | 'chatting' | 'working';

export interface AgentActivity {
  status: AgentStatus;
  /** Human-readable one-liner, e.g. "Replying to Bob's email" */
  detail: string;
  /** Timestamp when this activity was last updated (epoch ms) */
  updatedAt: number;
}

const activities = new Map<string, AgentActivity>();

/** Set or update an agent's current activity. */
export function setActivity(agent: string, status: AgentStatus, detail: string): void {
  activities.set(agent, { status, detail, updatedAt: Date.now() });
}

/** Reset an agent to idle (e.g. after auto-respond finishes). */
export function clearActivity(agent: string): void {
  activities.set(agent, { status: 'idle', detail: '', updatedAt: Date.now() });
}

/** Get a snapshot of all agent activities. */
export function getAllActivities(): Record<string, AgentActivity> {
  const result: Record<string, AgentActivity> = {};
  for (const [agent, act] of activities) {
    result[agent] = act;
  }
  return result;
}

/** Get a single agent's activity (defaults to idle if unknown). */
export function getActivity(agent: string): AgentActivity {
  return activities.get(agent) || { status: 'idle', detail: '', updatedAt: 0 };
}

/**
 * Clean up stale entries (agents that haven't updated in > 5 min).
 * Call periodically from the scheduler.
 */
export function pruneStaleActivities(): void {
  const cutoff = Date.now() - 300_000;
  for (const [agent, act] of activities) {
    if (act.updatedAt < cutoff && act.status !== 'idle') {
      activities.set(agent, { status: 'idle', detail: '', updatedAt: Date.now() });
    }
  }
}
