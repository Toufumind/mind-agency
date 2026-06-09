/**
 * TaskProxy — unified task management in Next.js process.
 *
 * Consolidates ALL task logic:
 *   - Task queue (pending/completed tasks)
 *   - Task reports (step-level results)
 *   - Task persistence
 *
 * Each agent has its own task queue.
 * Use getTaskProxy() to access.
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR, GROUPS_DIR, MIND_DIR } from './data-dir';
import { agentCache } from './cache';

// ── Types ─────────────────────────────────────────────────

export interface Task {
  id: string;
  agent: string;
  group?: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 'critical' | 'high' | 'normal' | 'low';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  workflow?: {
    runId: string;
    stepId: string;
  };
}

export interface TaskReport {
  stepId: string;
  agent: string;
  status: string;
  summary: string;
  details: string;
  timestamp: number;
}

// ── TaskProxy class ───────────────────────────────────────

export class TaskProxy {
  private _tasks: Map<string, Task[]> = new Map();
  private _loaded: Map<string, boolean> = new Map();

  constructor() {}

  // ── Task Queue ─────────────────────────────────────────

  /**
   * Get tasks for a specific agent.
   */
  async getAgentTasks(agentName: string): Promise<Task[]> {
    if (this._loaded.get(agentName)) {
      return this._tasks.get(agentName) || [];
    }

    const tasks: Task[] = [];
    try {
      const tasksFile = path.join(AGENTS_DIR, agentName, 'tasks.json');
      if (fs.existsSync(tasksFile)) {
        const data = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
        tasks.push(...data);
      }
    } catch {}

    this._tasks.set(agentName, tasks);
    this._loaded.set(agentName, true);

    return tasks;
  }

  /**
   * Get pending tasks for an agent.
   */
  async getPendingTasks(agentName: string): Promise<Task[]> {
    const tasks = await this.getAgentTasks(agentName);
    return tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
  }

  /**
   * Get completed tasks for an agent.
   */
  async getCompletedTasks(agentName: string): Promise<Task[]> {
    const tasks = await this.getAgentTasks(agentName);
    return tasks.filter(t => t.status === 'completed' || t.status === 'failed');
  }

  /**
   * Add a new task.
   */
  async addTask(task: Task): Promise<void> {
    const tasks = await this.getAgentTasks(task.agent);
    tasks.push(task);
    await this.saveTasks(task.agent, tasks);
  }

  /**
   * Update task status.
   */
  async updateTask(agentName: string, taskId: string, updates: Partial<Task>): Promise<boolean> {
    const tasks = await this.getAgentTasks(agentName);
    const task = tasks.find(t => t.id === taskId);
    if (!task) return false;

    Object.assign(task, updates);
    await this.saveTasks(agentName, tasks);

    return true;
  }

  /**
   * Complete a task.
   */
  async completeTask(agentName: string, taskId: string, result: string): Promise<boolean> {
    return this.updateTask(agentName, taskId, {
      status: 'completed',
      completedAt: Date.now(),
      result,
    });
  }

  /**
   * Fail a task.
   */
  async failTask(agentName: string, taskId: string, error: string): Promise<boolean> {
    return this.updateTask(agentName, taskId, {
      status: 'failed',
      completedAt: Date.now(),
      error,
    });
  }

  /**
   * Delete a task.
   */
  async deleteTask(agentName: string, taskId: string): Promise<boolean> {
    const tasks = await this.getAgentTasks(agentName);
    const index = tasks.findIndex(t => t.id === taskId);
    if (index === -1) return false;

    tasks.splice(index, 1);
    await this.saveTasks(agentName, tasks);

    return true;
  }

  /**
   * Save tasks to file.
   */
  private async saveTasks(agentName: string, tasks: Task[]): Promise<void> {
    try {
      const agentDir = path.join(AGENTS_DIR, agentName);
      if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });

      const tasksFile = path.join(agentDir, 'tasks.json');
      const tmp = tasksFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2), 'utf-8');
      fs.renameSync(tmp, tasksFile);

      this._tasks.set(agentName, tasks);
    } catch (err) {
      console.error(`[task-proxy] saveTasks(${agentName}):`, err);
    }
  }

  // ── Task Reports ───────────────────────────────────────

  /**
   * Get task reports for an agent.
   */
  async getTaskReports(agentName: string): Promise<TaskReport[]> {
    const reports: TaskReport[] = [];

    try {
      const reportsDir = path.join(MIND_DIR, 'agents', agentName, '.task-reports');
      if (!fs.existsSync(reportsDir)) return reports;

      const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const report = JSON.parse(fs.readFileSync(path.join(reportsDir, file), 'utf-8'));
          reports.push(report);
        } catch {}
      }
    } catch {}

    return reports;
  }

  /**
   * Save a task report.
   */
  async saveTaskReport(agentName: string, report: TaskReport): Promise<void> {
    try {
      const reportsDir = path.join(MIND_DIR, 'agents', agentName, '.task-reports');
      if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

      const reportFile = path.join(reportsDir, `${report.stepId}.json`);
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[task-proxy] saveTaskReport(${agentName}):`, err);
    }
  }

  /**
   * Delete a task report.
   */
  async deleteTaskReport(agentName: string, stepId: string): Promise<boolean> {
    try {
      const reportFile = path.join(MIND_DIR, 'agents', agentName, '.task-reports', `${stepId}.json`);
      if (!fs.existsSync(reportFile)) return false;

      fs.unlinkSync(reportFile);
      return true;
    } catch {}
    return false;
  }

  // ── Workflow Tasks ─────────────────────────────────────

  /**
   * Get workflow tasks for a group.
   */
  async getGroupWorkflowTasks(groupName: string): Promise<Task[]> {
    const tasks: Task[] = [];

    try {
      const wfDir = path.join(GROUPS_DIR, groupName, 'workflow');
      if (!fs.existsSync(wfDir)) return tasks;

      const files = fs.readdirSync(wfDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const task = JSON.parse(fs.readFileSync(path.join(wfDir, file), 'utf-8'));
          tasks.push(task);
        } catch {}
      }
    } catch {}

    return tasks;
  }

  // ── Cleanup ────────────────────────────────────────────

  /**
   * Invalidate cache for an agent.
   */
  invalidateCache(agentName: string): void {
    this._tasks.delete(agentName);
    this._loaded.delete(agentName);
  }

  /**
   * Invalidate all caches.
   */
  invalidateAll(): void {
    this._tasks.clear();
    this._loaded.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────

let instance: TaskProxy | null = null;

export function getTaskProxy(): TaskProxy {
  if (!instance) {
    instance = new TaskProxy();
  }
  return instance;
}
