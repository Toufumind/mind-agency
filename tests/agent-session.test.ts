/**
 * Agent Session Tests
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'path';

vi.mock('../src/lib/data-dir', () => ({
  AGENTS_DIR: path.join(__dirname, '.test-data', 'Agents'),
  MIND_DIR: path.join(__dirname, '.test-data', '.mind'),
  AUDIT_DIR: path.join(__dirname, '.test-data', '.audit'),
  GROUPS_DIR: path.join(__dirname, '.test-data', 'Groups'),
  MCP_DIR: path.join(__dirname, '..', 'mcp'),
  SRC_DIR: path.join(__dirname, '..', 'src'),
  DATA_DIR: path.join(__dirname, '.test-data'),
  default: path.join(__dirname, '.test-data'),
}));

vi.mock('../src/lib/atomic', () => ({
  atomicWrite: vi.fn((filePath: string, content: string) => {
    const fs = require('fs');
    const dir = require('path').dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
  }),
}));

import { loadAgentSession, saveAgentSession, clearAgentSession } from '../src/lib/agent-session';

describe('Agent Session', () => {
  it('should load empty session for new agent', async () => {
    const session = await loadAgentSession('test-session-new');
    expect(session).toHaveProperty('sessionId');
    expect(session).toHaveProperty('messages');
    expect(session.messages).toEqual([]);
  });

  it('should save and load session', async () => {
    const session = {
      sessionId: 'test-session',
      messages: [{ role: 'user' as const, content: 'Hello', timestamp: new Date().toISOString() }],
      _version: 0,
    };

    await saveAgentSession('test-session-save', session);
    const loaded = await loadAgentSession('test-session-save');

    expect(loaded.sessionId).toBe('test-session');
    expect(loaded.messages).toHaveLength(1);
  });

  it('should clear session', async () => {
    const session = {
      sessionId: 'test-clear',
      messages: [{ role: 'user' as const, content: 'Hello', timestamp: new Date().toISOString() }],
      _version: 0,
    };

    await saveAgentSession('test-session-clear', session);
    clearAgentSession('test-session-clear');

    const loaded = await loadAgentSession('test-session-clear');
    expect(loaded.messages).toEqual([]);
  });
});
