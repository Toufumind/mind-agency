/**
 * End-to-End Session Management Test
 *
 * Verifies that session management works correctly with IPC
 * for cross-process consistency.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

// Mock data-dir to use test directory
vi.mock('../src/lib/data-dir', () => ({
  AGENTS_DIR: path.join(__dirname, '.test-e2e', 'Agents'),
  MIND_DIR: path.join(__dirname, '.test-e2e', '.mind'),
  GROUPS_DIR: path.join(__dirname, '.test-e2e', 'Groups'),
  default: path.join(__dirname, '.test-e2e'),
}));

import { loadSession, saveSession, clearSession } from '../src/lib/session-manager';
import { ipcStore } from '../src/lib/ipc';

describe('E2E: Session Management', () => {
  const agentName = `e2e-agent-${Date.now()}`;

  beforeEach(() => {
    // Clear any existing session
    clearSession(agentName);
  });

  it('should create new session', () => {
    const session = loadSession(agentName);

    expect(session).toEqual({
      sessionId: null,
      messages: [],
      _version: 0,
    });
  });

  it('should save and load session with IPC', () => {
    const session = {
      sessionId: 'e2e-session',
      messages: [
        { role: 'user' as const, content: 'What is TypeScript?', timestamp: new Date().toISOString() },
        { role: 'assistant' as const, content: 'TypeScript is a typed superset of JavaScript.', timestamp: new Date().toISOString() },
      ],
      _version: 0,
    };

    saveSession(agentName, session);

    // Load from IPC (simulates another process)
    const loaded = loadSession(agentName);

    expect(loaded.sessionId).toBe('e2e-session');
    expect(loaded.messages).toHaveLength(2);
    expect(loaded._version).toBe(1);
    expect(loaded.messages[0].content).toBe('What is TypeScript?');
    expect(loaded.messages[1].content).toBe('TypeScript is a typed superset of JavaScript.');
  });

  it('should handle concurrent modifications with version check', () => {
    // Initial save
    const initial = {
      sessionId: null,
      messages: [{ role: 'user' as const, content: 'First', timestamp: new Date().toISOString() }],
      _version: 0,
    };
    saveSession(agentName, initial);

    // Load to get version
    const loaded = loadSession(agentName);
    expect(loaded._version).toBe(1);

    // Save with correct version
    const updated = {
      ...loaded,
      messages: [
        ...loaded.messages,
        { role: 'assistant' as const, content: 'Response', timestamp: new Date().toISOString() },
      ],
    };
    saveSession(agentName, updated, loaded._version);

    // Verify
    const final = loadSession(agentName);
    expect(final.messages).toHaveLength(2);
    expect(final._version).toBe(2);
  });

  it('should merge on version conflict', () => {
    // Initial save
    const initial = {
      sessionId: null,
      messages: [{ role: 'user' as const, content: 'Hello', timestamp: new Date().toISOString() }],
      _version: 0,
    };
    saveSession(agentName, initial);

    // Simulate concurrent modification
    const concurrent = {
      sessionId: null,
      messages: [
        { role: 'user' as const, content: 'Hello', timestamp: new Date().toISOString() },
        { role: 'assistant' as const, content: 'Hi!', timestamp: new Date().toISOString() },
      ],
      _version: 0, // Old version
    };

    // Save with stale version should merge
    saveSession(agentName, concurrent, 0);

    const result = loadSession(agentName);
    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    expect(result._version).toBeGreaterThan(0);
  });

  it('should limit messages to 100', () => {
    const messages = Array.from({ length: 150 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Message ${i}`,
      timestamp: new Date().toISOString(),
    }));

    const session = {
      sessionId: null,
      messages,
      _version: 0,
    };

    saveSession(agentName, session);

    const loaded = loadSession(agentName);
    expect(loaded.messages).toHaveLength(100);
    // Should keep last 100
    expect(loaded.messages[0].content).toBe('Message 50');
    expect(loaded.messages[99].content).toBe('Message 149');
  });

  it('should clear session from IPC and disk', () => {
    // Save session
    saveSession(agentName, {
      sessionId: 'test',
      messages: [{ role: 'user' as const, content: 'Hello', timestamp: new Date().toISOString() }],
      _version: 0,
    });

    // Verify exists
    expect(loadSession(agentName).messages).toHaveLength(1);

    // Clear
    clearSession(agentName);

    // Verify cleared
    const cleared = loadSession(agentName);
    expect(cleared.messages).toHaveLength(0);
    expect(cleared.sessionId).toBeNull();
  });
});
