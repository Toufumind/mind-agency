/**
 * Session Manager Tests
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'path';

vi.mock('../src/lib/data-dir', () => ({
  AGENTS_DIR: path.join(__dirname, '.test-data', 'Agents'),
  MIND_DIR: path.join(__dirname, '.test-data', '.mind'),
  GROUPS_DIR: path.join(__dirname, '.test-data', 'Groups'),
  default: path.join(__dirname, '.test-data'),
}));

import { loadSession, saveSession, clearSession } from '../src/lib/session-manager';

describe('Session Manager', () => {
  it('should load empty session for new agent', () => {
    const session = loadSession('test-new-session');
    expect(session).toEqual({ sessionId: null, messages: [], _version: 0 });
  });

  it('should save and load session', () => {
    const session = {
      sessionId: 'test-session',
      messages: [
        { role: 'user' as const, content: 'Hello', timestamp: new Date().toISOString() },
        { role: 'assistant' as const, content: 'Hi!', timestamp: new Date().toISOString() },
      ],
      _version: 0,
    };

    saveSession('test-save-session', session);
    const loaded = loadSession('test-save-session');

    expect(loaded.sessionId).toBe('test-session');
    expect(loaded.messages).toHaveLength(2);
    expect(loaded._version).toBe(1);
  });

  it('should handle version conflicts', () => {
    const session = {
      sessionId: null,
      messages: [{ role: 'user' as const, content: 'First', timestamp: new Date().toISOString() }],
      _version: 0,
    };

    saveSession('test-version', session);
    const loaded = loadSession('test-version');
    expect(loaded._version).toBe(1);
  });

  it('should clear session', () => {
    const session = {
      sessionId: 'test',
      messages: [{ role: 'user' as const, content: 'Hello', timestamp: new Date().toISOString() }],
      _version: 0,
    };

    saveSession('test-clear', session);
    clearSession('test-clear');

    const loaded = loadSession('test-clear');
    expect(loaded.messages).toEqual([]);
  });

  it('should limit messages to 100', () => {
    const messages = Array.from({ length: 150 }, (_, i) => ({
      role: 'user' as const,
      content: `Message ${i}`,
      timestamp: new Date().toISOString(),
    }));

    const session = {
      sessionId: null,
      messages,
      _version: 0,
    };

    saveSession('test-limit', session);
    const loaded = loadSession('test-limit');

    expect(loaded.messages).toHaveLength(100);
    expect(loaded.messages[0].content).toBe('Message 50');
  });
});
