/**
 * Agent Task Queue — per-agent pending/completed task tracking
 *
 * Storage: Agents/<name>/tasks.json
 *
 * Each agent has a persistent task list:
 *   - pending: tasks waiting to be processed
 *   - completed: tasks that have been processed (last 50)
 *
 * Used by:
 *   - workflow engine (notifyAgent / callback)
 *   - auto-respond (priority scanning)
 *   - MCP agent_tasks tool (agent self-management)
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR } from './data-dir';
import { agentCache } from './cache';

export interface AgentTask {
  runId: string;
  stepId: string;
  workflow: string;
  prompt: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;  // workflow_callback output
}

export interface AgentTaskQueue {
  pending: AgentTask[];
  completed: AgentTask[];  // last 50
}

const MAX_COMPLETED = 50;

function tasksFile(agentName: string): string {
  return path.join(AGENTS_DIR, agentName, 'tasks.json');
}

/** Load agent's task queue */
export function loadTaskQueue(agentName: string): AgentTaskQueue {
  const cached = agentCache.get<AgentTaskQueue>('config', `tasks:${agentName}`);
  if (cached) return cached;

  const file = tasksFile(agentName);
  let queue: AgentTaskQueue;
  try {
    if (fs.existsSync(file)) {
      queue = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (!Array.isArray(queue.pending)) queue.pending = [];
      if (!Array.isArray(queue.completed)) queue.completed = [];
    } else {
      queue = { pending: [], completed: [] };
    }
  } catch {
    queue = { pending: [], completed: [] };
  }

  agentCache.set('config', `tasks:${agentName}`, queue);
  return queue;
}

/** Save agent's task queue */
function saveTaskQueue(agentName: string, queue: AgentTaskQueue): void {
  const dir = path.join(AGENTS_DIR, agentName);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = tasksFile(agentName);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(queue, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
  agentCache.set('config', `tasks:${agentName}`, queue);
}

/** Add a task to the pending queue */
export function enqueueTask(agentName: string, task: Omit<AgentTask, 'status' | 'createdAt'>): AgentTask {
  const queue = loadTaskQueue(agentName);

  // Dedup: don't add if same runId+stepId already pending
  const existing = queue.pending.find(t => t.runId === task.runId && t.stepId === task.stepId);
  if (existing) return existing;

  const fullTask: AgentTask = {
    ...task,
    status: 'pending',
    createdAt: Date.now(),
  };

  queue.pending.push(fullTask);

  // Sort by priority
  const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };
  queue.pending.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2));

  saveTaskQueue(agentName, queue);
  return fullTask;
}

/** Complete a task — move from pending to completed */
export function completeTask(agentName: string, runId: string, stepId: string, result: string, status: 'completed' | 'failed'): boolean {
  const queue = loadTaskQueue(agentName);
  const idx = queue.pending.findIndex(t => t.runId === runId && t.stepId === stepId);
  if (idx === -1) return false;

  const [task] = queue.pending.splice(idx, 1);
  task.status = status;
  task.completedAt = Date.now();
  task.result = result;

  queue.completed.unshift(task);
  if (queue.completed.length > MAX_COMPLETED) {
    queue.completed = queue.completed.slice(0, MAX_COMPLETED);
  }

  saveTaskQueue(agentName, queue);
  return true;
}

/** Get next pending task (highest priority) */
export function nextTask(agentName: string): AgentTask | null {
  const queue = loadTaskQueue(agentName);
  return queue.pending[0] || null;
}

/** Get all pending tasks */
export function getPendingTasks(agentName: string): AgentTask[] {
  return loadTaskQueue(agentName).pending;
}

/** Get recent completed tasks */
export function getCompletedTasks(agentName: string, limit = 10): AgentTask[] {
  return loadTaskQueue(agentName).completed.slice(0, limit);
}

/** Format task queue as human-readable string */
export function formatTaskQueue(agentName: string): string {
  const queue = loadTaskQueue(agentName);
  const lines: string[] = [];

  if (queue.pending.length > 0) {
    lines.push(`📋 待处理任务 (${queue.pending.length}):`);
    for (const t of queue.pending) {
      const age = Math.round((Date.now() - t.createdAt) / 60_000);
      lines.push(`  [${t.priority}] ${t.stepId} (${t.workflow}) — ${age}分钟前 | runId=${t.runId}`);
    }
  } else {
    lines.push('📋 无待处理任务');
  }

  if (queue.completed.length > 0) {
    lines.push(`\n✅ 最近完成 (${queue.completed.length}):`);
    for (const t of queue.completed.slice(0, 5)) {
      lines.push(`  ${t.status === 'completed' ? '✅' : '❌'} ${t.stepId} (${t.workflow}) — ${t.result?.slice(0, 50) || 'no result'}`);
    }
  }

  return lines.join('\n');
}
