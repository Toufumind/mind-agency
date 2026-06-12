/**
 * State Tests
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

import { loadState, saveState, ensureGroup, getAgentGroups } from '../src/lib/state';

describe('State', () => {
  it('should load state', () => {
    const state = loadState('test-state');
    expect(state).toBeDefined();
    expect(state).toHaveProperty('groups');
  });

  it('should save state', () => {
    const state = loadState('test-save');
    saveState('test-save', state);
    // Just verify it doesn't throw
    expect(true).toBe(true);
  });

  it('should ensure group', () => {
    const state = loadState('test-ensure');
    const group = ensureGroup(state, 'test-group');
    expect(group).toBeDefined();
    expect(group).toHaveProperty('chatCheck');
  });

  it('should get agent groups', () => {
    const groups = getAgentGroups('test-groups');
    expect(Array.isArray(groups)).toBe(true);
  });
});
