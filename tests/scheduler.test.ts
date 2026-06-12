/**
 * Scheduler Tests
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

vi.mock('../src/lib/agency', () => ({
  getAgency: vi.fn().mockReturnValue({
    agents: { getAll: vi.fn().mockResolvedValue([]) },
  }),
}));

vi.mock('../src/lib/event-bus', () => ({
  getEventBus: vi.fn().mockReturnValue({
    emit: vi.fn(),
  }),
  EventType: {
    AGENT_STATUS_CHANGED: 'agent.status.changed',
  },
  createEvent: vi.fn().mockReturnValue({}),
}));

import { startScheduler, stopScheduler, markAgentActive } from '../src/lib/scheduler';

describe('Scheduler', () => {
  it('should start and stop scheduler', () => {
    startScheduler();
    stopScheduler();
    // Just verify it doesn't throw
    expect(true).toBe(true);
  });

  it('should mark agent active', () => {
    markAgentActive('test-agent');
    // Just verify it doesn't throw
    expect(true).toBe(true);
  });
});
