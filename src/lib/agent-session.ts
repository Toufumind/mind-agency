/**
 * agent-session.ts — Session (chat history) management for AgentProxy.
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR } from './data-dir';
import { agentCache } from './cache';
import { ChatHistory } from './agent-types';

/**
 * Load agent session from disk (session.json).
 * Returns the parsed session, or default empty session on error.
 */
export async function loadAgentSession(agentName: string): Promise<ChatHistory> {
  try {
    const file = path.join(AGENTS_DIR, agentName, 'chat', 'session.json');
    if (fs.existsSync(file)) {
      const session: ChatHistory = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (typeof session._version !== 'number') session._version = 0;
      return session;
    }
  } catch (e) { console.error('[lib:agent-session]', e); }
  return { sessionId: null, messages: [], _version: 0 };
}

/**
 * Save agent session to disk (session.json) with atomic write.
 */
export async function saveAgentSession(agentName: string, session: ChatHistory): Promise<void> {
  try {
    const sessionDir = path.join(AGENTS_DIR, agentName, 'chat');
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const file = path.join(sessionDir, 'session.json');
    const tmp = file + '.tmp';
    session._version = (session._version || 0) + 1;
    fs.writeFileSync(tmp, JSON.stringify(session, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
    agentCache.set('session', agentName, session);
  } catch (err) {
    console.error(`[agent-session] saveAgentSession(${agentName}):`, err);
  }
}

/**
 * Clear agent session from disk.
 */
export function clearAgentSession(agentName: string): void {
  try {
    const file = path.join(AGENTS_DIR, agentName, 'chat', 'session.json');
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (e) { console.error('[lib:agent-session]', e); }
  agentCache.invalidate('session', agentName);
}
