/**
 * Agent Activity Tests
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

import { setActivity, clearActivity, getActivity } from '../src/lib/agent-activity';

describe('Agent Activity', () => {
  it('should set and get activity', () => {
    setActivity('test-activity-agent', 'chatting', '对话中');
    const activity = getActivity('test-activity-agent');
    expect(activity).toBeTruthy();
    expect(activity!.status).toBe('chatting');
    expect(activity!.detail).toBe('对话中');
  });

  it('should clear activity', () => {
    setActivity('test-clear-agent', 'working', '工作中');
    clearActivity('test-clear-agent');
    const activity = getActivity('test-clear-agent');
    expect(activity!.status).toBe('idle');
  });

  it('should return idle for unknown agent', () => {
    const activity = getActivity('unknown-agent');
    expect(activity).toBeTruthy();
    expect(activity!.status).toBe('idle');
  });
});
