/**
 * Agent read-state tracking.
 *
 * Tracks per-agent "last check" timestamps for emails and group chat.
 * Used to determine "what's new since last time" without hashing every message.
 *
 * State file: Agents/<name>/chat/mind-state.json
 *
 * v1.3: Uses AgentProxy for unified state management.
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR, GROUPS_DIR } from './data-dir';
import { getAgentRegistry } from './agent-registry';
import { GroupState, AgentState } from './agent-proxy';

// Re-export types for backward compatibility
export type { GroupState, AgentState };

const DEFAULT_STATE: AgentState = { emailCheck: 0, groups: {} };

export function loadState(agent: string): AgentState {
  const proxy = getAgentRegistry().getOrCreate(agent);
  const cached = proxy.state;
  if (cached && (cached.emailCheck > 0 || Object.keys(cached.groups).length > 0)) {
    return cached;
  }
  // Sync fallback — load from disk directly
  try {
    const file = stateFile(agent);
    if (fs.existsSync(file)) {
      const data = { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(file, 'utf-8')) };
      proxy.setState(data);
      return data;
    }
  } catch {}
  return { ...DEFAULT_STATE };
}

export function saveState(agent: string, state: AgentState): void {
  const proxy = getAgentRegistry().getOrCreate(agent);
  proxy.setState(state);

  const file = stateFile(agent);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

function stateFile(agent: string): string {
  return path.join(AGENTS_DIR, agent, 'chat', 'mind-state.json');
}

/** Ensure a group entry exists in the agent's state, initialising if needed. */
export function ensureGroup(state: AgentState, group: string): GroupState {
  if (!state.groups[group]) {
    state.groups[group] = { chatCheck: 0, emailCheck: 0 };
  }
  return state.groups[group];
}

/** List all group directories the agent belongs to. Cached for 300s. */
const groupsCache = new Map<string, { ts: number; groups: string[] }>();
const GROUPS_CACHE_TTL = 300_000;

export function getAgentGroups(agent: string): string[] {
  const cached = groupsCache.get(agent);
  const now = Date.now();
  if (cached && (now - cached.ts) < GROUPS_CACHE_TTL) return cached.groups;

  const groups: string[] = [];
  if (fs.existsSync(GROUPS_DIR)) {
    for (const g of fs.readdirSync(GROUPS_DIR, { withFileTypes: true })) {
      if (!g.isDirectory() || g.name.startsWith('.')) continue;
      const agDir = path.join(GROUPS_DIR, g.name, 'Agents');
      if (!fs.existsSync(agDir)) continue;
      if (fs.readdirSync(agDir, { withFileTypes: true }).some(
        e => e.isDirectory() && e.name.toLowerCase() === agent.toLowerCase()
      )) {
        groups.push(g.name);
      }
    }
  }

  groupsCache.set(agent, { ts: now, groups });
  return groups;
}

/** Invalidate cache when agent joins/leaves a group */
export function invalidateGroupsCache(agent?: string): void {
  if (agent) { groupsCache.delete(agent); } else { groupsCache.clear(); }
}
