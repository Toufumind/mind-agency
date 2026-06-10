/**
 * agent-state.ts — State management for AgentProxy.
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR } from './data-dir';
import { agentCache } from './cache';
import { AgentState, DEFAULT_STATE } from './agent-types';

/**
 * Load agent state from disk (mind-state.json).
 * Returns the parsed state, or DEFAULT_STATE on error.
 */
export async function loadAgentState(agentName: string): Promise<AgentState> {
  try {
    const file = path.join(AGENTS_DIR, agentName, 'chat', 'mind-state.json');
    if (fs.existsSync(file)) {
      return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(file, 'utf-8')) };
    }
  } catch {}
  return { ...DEFAULT_STATE, groups: {} };
}

/**
 * Save agent state to disk (mind-state.json).
 */
export async function saveAgentState(agentName: string, state: AgentState): Promise<void> {
  try {
    const stateDir = path.join(AGENTS_DIR, agentName, 'chat');
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });

    const file = path.join(stateDir, 'mind-state.json');
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8');
    agentCache.invalidate('state', agentName);
  } catch (err) {
    console.error(`[agent-state] saveAgentState(${agentName}):`, err);
  }
}
