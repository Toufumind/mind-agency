/**
 * Agents Tests
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

import { getAgents, getAgentEmails, invalidateAgentsCache } from '../src/lib/agents';

describe('Agents', () => {
  it('should get all agents', () => {
    const agents = getAgents();
    expect(Array.isArray(agents)).toBe(true);
  });

  it('should get agent emails', () => {
    const emails = getAgentEmails('test-agent');
    expect(Array.isArray(emails)).toBe(true);
  });

  it('should invalidate agents cache', () => {
    invalidateAgentsCache();
    // Just verify it doesn't throw
    expect(true).toBe(true);
  });
});
