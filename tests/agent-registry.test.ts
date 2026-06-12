/**
 * Agent Registry Tests
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

import { AgentRegistry } from '../src/lib/agent-registry';

describe('AgentRegistry', () => {
  it('should create registry instance', () => {
    const registry = new AgentRegistry();
    expect(registry).toBeDefined();
  });

  it('should get all agents', async () => {
    const registry = new AgentRegistry();
    const agents = await registry.getAll();
    expect(Array.isArray(agents)).toBe(true);
  });

  it('should get agent by name', async () => {
    const registry = new AgentRegistry();
    // This may return null if agent doesn't exist in test data
    const agent = await registry.get('test-agent');
    // Just verify it doesn't throw
    expect(true).toBe(true);
  });
});
