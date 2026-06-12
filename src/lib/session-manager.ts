/**
 * session-manager.ts — Unified session management for AgentProxy and chat.ts
 *
 * This module provides a single source of truth for session persistence,
 * eliminating code duplication between chat.ts and agent-proxy.ts.
 *
 * Uses IPC (SQLite) for cross-process consistency between Next.js and WebSocket servers.
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR } from './data-dir';
import { agentCache } from './cache';
import { ipcStore, getIPCLock } from './ipc';
import type { ChatHistory, ChatEvent } from './agent-types';

const MAX_MESSAGES = 100;

/**
 * Load session from IPC store or disk
 */
export function loadSession(agentName: string): ChatHistory {
  // Check in-memory cache first
  const cached = agentCache.get<ChatHistory>('session', agentName);
  if (cached) return JSON.parse(JSON.stringify(cached));

  // Try IPC store (cross-process consistency)
  const ipcData = ipcStore.get<ChatHistory>(`session:${agentName}`);
  if (ipcData) {
    agentCache.set('session', agentName, ipcData);
    return JSON.parse(JSON.stringify(ipcData));
  }

  // Fall back to disk
  const file = getSessionFile(agentName);
  let data: ChatHistory;

  try {
    if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (typeof data._version !== 'number') data._version = 0;
    } else {
      data = { sessionId: null, messages: [], _version: 0 };
    }
  } catch {
    data = { sessionId: null, messages: [], _version: 0 };
  }

  // Store in IPC and cache
  ipcStore.set(`session:${agentName}`, data);
  agentCache.set('session', agentName, data);
  return JSON.parse(JSON.stringify(data));
}

/**
 * Save session with IPC lock for cross-process consistency
 */
export function saveSession(agentName: string, data: ChatHistory, expectedVersion?: number): void {
  // Acquire lock for this agent's session
  const lock = getIPCLock(`session:${agentName}`);

  if (!lock.acquire(5000)) {
    console.warn(`[session-manager] Could not acquire lock for ${agentName}, saving anyway`);
  }

  try {
    // Version check — prevent concurrent overwrites
    if (expectedVersion !== undefined) {
      const cached = agentCache.get<ChatHistory>('session', agentName) ||
                     ipcStore.get<ChatHistory>(`session:${agentName}`);

      if (cached && cached._version !== undefined && cached._version !== expectedVersion) {
        // Another request modified the session — merge messages
        const merged = JSON.parse(JSON.stringify(cached)) as ChatHistory;

        const existingKeys = new Set(merged.messages.map(m => `${m.role}:${m.content.slice(0, 50)}`));
        for (const msg of data.messages) {
          const key = `${msg.role}:${msg.content.slice(0, 50)}`;
          if (!existingKeys.has(key)) {
            merged.messages.push(msg);
          }
        }

        if (merged.messages.length > MAX_MESSAGES) {
          merged.messages = merged.messages.slice(-MAX_MESSAGES);
        }

        merged.sessionId = data.sessionId || merged.sessionId;
        merged._version = (cached._version || 0) + 1;
        data = merged;
      }
    }

    // Increment version
    data._version = (data._version || 0) + 1;

    // Trim messages
    if (data.messages.length > MAX_MESSAGES) {
      data.messages = data.messages.slice(-MAX_MESSAGES);
    }

    // Save to IPC store (primary)
    ipcStore.set(`session:${agentName}`, data);

    // Save to disk (backup)
    const dir = path.join(AGENTS_DIR, agentName, 'chat');
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = getSessionFile(agentName);
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error(`[session-manager] Disk save failed for ${agentName}:`, err);
    }

    // Update cache
    agentCache.set('session', agentName, data);
  } finally {
    lock.release();
  }
}

/**
 * Add a message to the session
 */
export function addMessage(agentName: string, role: 'user' | 'assistant', content: string, events?: ChatEvent[]): void {
  const session = loadSession(agentName);
  session.messages.push({
    role,
    content,
    events,
    timestamp: new Date().toISOString(),
  });

  if (session.messages.length > MAX_MESSAGES) {
    session.messages = session.messages.slice(-MAX_MESSAGES);
  }

  saveSession(agentName, session);
}

/**
 * Clear session
 */
export function clearSession(agentName: string): void {
  // Clear from IPC
  ipcStore.delete(`session:${agentName}`);

  // Clear from disk
  const file = getSessionFile(agentName);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    console.warn(`[session-manager] Failed to clear session for ${agentName}:`, err);
  }

  // Clear from cache
  agentCache.invalidate('session', agentName);
}

/**
 * Get session file path
 */
function getSessionFile(agentName: string): string {
  return path.join(AGENTS_DIR, agentName, 'chat', 'session.json');
}

/**
 * Invalidate session cache
 */
export function invalidateSessionCache(agentName: string): void {
  agentCache.invalidate('session', agentName);
  ipcStore.delete(`session:${agentName}`);
}
