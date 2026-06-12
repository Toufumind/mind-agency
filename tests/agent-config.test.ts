/**
 * Agent Config Tests
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

import { loadAgentConfig, saveAgentConfig } from '../src/lib/agent-config';

describe('Agent Config', () => {
  it('should load default config for new agent', async () => {
    const config = await loadAgentConfig('test-new-config');
    expect(typeof config).toBe('object');
  });

  it('should save and load config', async () => {
    const config = { roles: ['developer'], provider: 'claude' };
    await saveAgentConfig('test-save-config', config);

    const loaded = await loadAgentConfig('test-save-config');
    expect(loaded.roles).toContain('developer');
  });
});
