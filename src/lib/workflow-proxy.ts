/**
 * WorkflowProxy — unified workflow management in Next.js process.
 *
 * Consolidates ALL workflow logic:
 *   - Workflow definitions (workflow.yaml)
 *   - Workflow runs (checkpoint meta)
 *   - Run history (.workflow-history/runs.jsonl)
 *   - Checkpoints (per-step status)
 *
 * Singleton instance — use getWorkflowProxy() to access.
 */

import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from './data-dir';
import {
  loadRunMeta,
  loadRunCheckpoints,
  loadRunHistory as loadRunHistoryFromDisk,
  type RunCheckpoint,
  type StepCheckpoint,
  type RunHistoryRecord,
} from './workflow-checkpoint';

// ── Types ─────────────────────────────────────────────────

export type { RunCheckpoint, StepCheckpoint, RunHistoryRecord };

// ── WorkflowProxy class ───────────────────────────────────

export class WorkflowProxy {
  private _workflowCache: Map<string, { content: string; mtime: number }> = new Map();

  constructor() {}

  // ── Workflow Definition ───────────────────────────────

  /**
   * Get workflow YAML definition for a group.
   */
  async getWorkflow(groupName: string): Promise<string | null> {
    const cached = this._workflowCache.get(groupName);
    try {
      const wfPath = path.join(GROUPS_DIR, groupName, 'workflow.yaml');
      if (!fs.existsSync(wfPath)) return null;

      const stat = fs.statSync(wfPath);
      if (cached && cached.mtime === stat.mtimeMs) {
        return cached.content;
      }

      const content = fs.readFileSync(wfPath, 'utf-8');
      this._workflowCache.set(groupName, { content, mtime: stat.mtimeMs });
      return content;
    } catch (e) { console.error('[lib:workflow-proxy]', e); }
    return null;
  }

  /**
   * Save workflow YAML definition for a group.
   */
  async saveWorkflow(groupName: string, yaml: string): Promise<boolean> {
    try {
      const groupDir = path.join(GROUPS_DIR, groupName);
      if (!fs.existsSync(groupDir)) fs.mkdirSync(groupDir, { recursive: true });

      const wfPath = path.join(groupDir, 'workflow.yaml');
      const tmp = wfPath + '.tmp';
      fs.writeFileSync(tmp, yaml, 'utf-8');
      fs.renameSync(tmp, wfPath);

      // Update cache
      this._workflowCache.set(groupName, {
        content: yaml,
        mtime: fs.statSync(wfPath).mtimeMs,
      });

      return true;
    } catch (err) {
      console.error(`[workflow-proxy] saveWorkflow(${groupName}):`, err);
      return false;
    }
  }

  // ── Runs ─────────────────────────────────────────────

  /**
   * Get run metadata for a group.
   */
  async getRuns(groupName: string): Promise<RunCheckpoint[]> {
    const cpDir = path.join(GROUPS_DIR, groupName, '.checkpoints');
    if (!fs.existsSync(cpDir)) return [];

    const runs: RunCheckpoint[] = [];
    try {
      const entries = fs.readdirSync(cpDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const meta = loadRunMeta(groupName, entry.name);
        if (meta) runs.push(meta);
      }
    } catch (e) { console.error('[lib:workflow-proxy]', e); }

    return runs.sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * Get checkpoints (step-level status) for a specific run.
   */
  async getCheckpoints(groupName: string, runId: string): Promise<StepCheckpoint[]> {
    return loadRunCheckpoints(groupName, runId);
  }

  /**
   * Load run history for a group (most recent first).
   */
  async loadRunHistory(groupName: string, limit: number = 50): Promise<RunHistoryRecord[]> {
    return loadRunHistoryFromDisk(groupName, limit);
  }

  // ── Cleanup ──────────────────────────────────────────

  /**
   * Invalidate workflow cache for a group.
   */
  invalidateCache(groupName?: string): void {
    if (groupName) {
      this._workflowCache.delete(groupName);
    } else {
      this._workflowCache.clear();
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this._workflowCache.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────

let instance: WorkflowProxy | null = null;

export function getWorkflowProxy(): WorkflowProxy {
  if (!instance) {
    instance = new WorkflowProxy();
  }
  return instance;
}
