/**
 * Agent State Tests
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

import { loadAgentState, saveAgentState } from '../src/lib/agent-state';

describe('Agent State', () => {
  it('should load default state for new agent', async () => {
    const state = await loadAgentState('test-new-state');
    expect(state).toBeDefined();
    expect(state).toHaveProperty('emailCheck');
    expect(state).toHaveProperty('groups');
  });

  it('should save and load state', async () => {
    const state = { emailCheck: Date.now(), groups: {} };
    await saveAgentState('test-save-state', state);

    const loaded = await loadAgentState('test-save-state');
    expect(loaded.emailCheck).toBe(state.emailCheck);
  });
});
