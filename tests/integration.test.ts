/**
 * Integration Tests
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'path';

vi.mock('../src/lib/data-dir', () => ({
  MIND_DIR: path.join(__dirname, '.test-data', '.mind'),
  AGENTS_DIR: path.join(__dirname, '.test-data', 'Agents'),
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
    const p = require('path');
    const dir = p.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
  }),
}));

import { getAgency } from '../src/lib/agency';
import { loadSession, saveSession } from '../src/lib/session-manager';
import { loadAgentConfig } from '../src/lib/agent-config';

describe('Integration', () => {
  it('should load agency and get agents', async () => {
    const agency = getAgency();
    expect(agency).toBeDefined();
    expect(agency.agents).toBeDefined();
  });

  it('should save and load session across modules', () => {
    const session = {
      sessionId: 'integration-test',
      messages: [
        { role: 'user' as const, content: 'Hello', timestamp: new Date().toISOString() },
        { role: 'assistant' as const, content: 'Hi!', timestamp: new Date().toISOString() },
      ],
      _version: 0,
    };

    saveSession('integration-agent', session);
    const loaded = loadSession('integration-agent');

    expect(loaded.sessionId).toBe('integration-test');
    expect(loaded.messages).toHaveLength(2);
  });

  it('should load agent config', async () => {
    const config = await loadAgentConfig('integration-agent');
    expect(config).toBeDefined();
    expect(typeof config).toBe('object');
  });
});
