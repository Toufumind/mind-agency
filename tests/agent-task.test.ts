/**
 * Agent Task Tests
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

vi.mock('../src/lib/atomic', () => ({
  atomicWrite: vi.fn((filePath: string, content: string) => {
    const fs = require('fs');
    const p = require('path');
    const dir = p.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
  }),
}));

import { loadAgentTasks, saveAgentTasks, addAgentTask, completeAgentTask } from '../src/lib/agent-task';
import type { AgentTask } from '../src/lib/agent-types';

describe('Agent Task', () => {
  it('should load empty tasks for new agent', async () => {
    const tasks = await loadAgentTasks('test-task-new');
    expect(Array.isArray(tasks)).toBe(true);
  });

  it('should add and load tasks', async () => {
    const tasks: AgentTask[] = [];
    const task: AgentTask = {
      runId: 'run-1',
      stepId: 'step-1',
      workflow: 'test-workflow',
      prompt: 'test prompt',
      priority: 'normal',
      status: 'pending',
      createdAt: Date.now(),
    };

    await addAgentTask('test-task-add', tasks, task);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].runId).toBe('run-1');
  });

  it('should complete task', async () => {
    const tasks: AgentTask[] = [{
      runId: 'run-2',
      stepId: 'step-2',
      workflow: 'test-workflow',
      prompt: 'test prompt',
      priority: 'normal',
      status: 'pending',
      createdAt: Date.now(),
    }];

    await completeAgentTask('test-task-complete', tasks, 'run-2', 'done');
    expect(tasks[0].status).toBe('completed');
    expect(tasks[0].result).toBe('done');
  });
});
