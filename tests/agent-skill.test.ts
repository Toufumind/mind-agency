/**
 * Agent Skill Tests
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

import { loadAgentSkills, loadAgentSkillsContext } from '../src/lib/agent-skill';

describe('Agent Skill', () => {
  it('should load skills for agent', async () => {
    const skills = await loadAgentSkills('test-skill-agent');
    expect(Array.isArray(skills)).toBe(true);
  });

  it('should load skills context', async () => {
    const context = await loadAgentSkillsContext('test-skill-agent');
    expect(typeof context).toBe('string');
  });
});
