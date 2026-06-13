/**
 * agent-task.ts — Task management for AgentProxy.
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR } from './data-dir';
import { AgentTask } from './agent-types';

/**
 * Load agent tasks from disk (tasks.json).
 */
export async function loadAgentTasks(agentName: string): Promise<AgentTask[]> {
  try {
    const file = path.join(AGENTS_DIR, agentName, 'tasks.json');
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch (e) { console.error('[lib:agent-task]', e); }
  return [];
}

/**
 * Save agent tasks to disk (tasks.json).
 */
export async function saveAgentTasks(agentName: string, tasks: AgentTask[]): Promise<void> {
  try {
    const agentDir = path.join(AGENTS_DIR, agentName);
    if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });

    const file = path.join(agentDir, 'tasks.json');
    fs.writeFileSync(file, JSON.stringify(tasks, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[agent-task] saveAgentTasks(${agentName}):`, err);
  }
}

/**
 * Add a task to the agent's task list.
 */
export async function addAgentTask(agentName: string, tasks: AgentTask[], task: AgentTask): Promise<void> {
  tasks.push(task);
  await saveAgentTasks(agentName, tasks);
}

/**
 * Mark a task as completed with a result.
 */
export async function completeAgentTask(agentName: string, tasks: AgentTask[], runId: string, result: string): Promise<void> {
  const task = tasks.find(t => t.runId === runId);
  if (task) {
    task.status = 'completed';
    task.result = result;
    await saveAgentTasks(agentName, tasks);
  }
}
