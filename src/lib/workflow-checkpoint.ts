/**
 * Workflow Checkpoint — v0.4 (JSON files)
 *
 * Persists workflow step completion to disk so runs survive process restarts.
 * Uses JSON files — no native dependencies, works in Electron.
 *
 * Storage: Groups/<group>/.checkpoints/<runId>/
 *   - meta.json      — run metadata
 *   - <stepId>.json  — per-step checkpoint
 */

import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from './data-dir';

const CHECKPOINT_DIR = '.checkpoints';

export interface StepCheckpoint {
  stepId: string;
  status: string;
  output: string;
  error?: string;
  retries: number;
  timestamp: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

export interface RunCheckpoint {
  runId: string;
  workflowName: string;
  group: string;
  startedAt: number;
  completedAt?: number;
  status: string;
  steps: StepCheckpoint[];
}

export interface RunHistoryRecord {
  runId: string;
  workflowName: string;
  group: string;
  startedAt: number;
  completedAt: number;
  status: string;
  stepsTotal: number;
  stepsCompleted: number;
  stepsFailed: number;
  compensations: number;
}

function runDir(group: string, runId: string): string {
  return path.join(GROUPS_DIR, group, CHECKPOINT_DIR, runId);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function saveRunMeta(group: string, runId: string, meta: { workflowName: string; startedAt: number; status: string }): void {
  const dir = runDir(group, runId);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ ...meta, runId, group }, null, 2), 'utf-8');
}

export function saveStepCheckpoint(group: string, runId: string, step: StepCheckpoint): void {
  const dir = runDir(group, runId);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, `${step.stepId}.json`), JSON.stringify(step, null, 2), 'utf-8');
}

export function completeRunCheckpoint(group: string, runId: string, status: string): void {
  const metaPath = path.join(runDir(group, runId), 'meta.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.status = status;
    meta.completedAt = Date.now();
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  } catch {}
}

export function loadRunCheckpoints(group: string, runId: string): StepCheckpoint[] {
  const dir = runDir(group, runId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && f !== 'meta.json')
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); } catch { return null; } })
    .filter((s): s is StepCheckpoint => s !== null);
}

export function loadRunMeta(group: string, runId: string): RunCheckpoint | null {
  const metaPath = path.join(runDir(group, runId), 'meta.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return { ...meta, steps: loadRunCheckpoints(group, runId) };
  } catch { return null; }
}

export function findIncompleteRuns(): Array<{ group: string; runId: string; meta: RunCheckpoint }> {
  const results: Array<{ group: string; runId: string; meta: RunCheckpoint }> = [];
  if (!fs.existsSync(GROUPS_DIR)) return results;
  for (const g of fs.readdirSync(GROUPS_DIR, { withFileTypes: true })) {
    if (!g.isDirectory() || g.name.startsWith('.')) continue;
    const cpDir = path.join(GROUPS_DIR, g.name, CHECKPOINT_DIR);
    if (!fs.existsSync(cpDir)) continue;
    for (const r of fs.readdirSync(cpDir, { withFileTypes: true })) {
      if (!r.isDirectory()) continue;
      const meta = loadRunMeta(g.name, r.name);
      if (meta && meta.status === 'running') results.push({ group: g.name, runId: r.name, meta });
    }
  }
  return results;
}

export function appendRunHistory(group: string, record: RunHistoryRecord): void {
  const histDir = path.join(GROUPS_DIR, group, '.workflow-history');
  ensureDir(histDir);
  fs.appendFileSync(path.join(histDir, 'runs.jsonl'), JSON.stringify(record) + '\n', 'utf-8');
}

export function loadRunHistory(group: string, limit = 50): RunHistoryRecord[] {
  const histFile = path.join(GROUPS_DIR, group, '.workflow-history', 'runs.jsonl');
  if (!fs.existsSync(histFile)) return [];
  try {
    const lines = fs.readFileSync(histFile, 'utf-8').split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => JSON.parse(l)).reverse();
  } catch { return []; }
}

export function cleanupCheckpoints(group: string, keepLast = 10): number {
  const cpDir = path.join(GROUPS_DIR, group, CHECKPOINT_DIR);
  if (!fs.existsSync(cpDir)) return 0;
  const runs = fs.readdirSync(cpDir, { withFileTypes: true }).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  if (runs.length <= keepLast) return 0;
  for (const r of runs.slice(0, runs.length - keepLast)) {
    fs.rmSync(path.join(cpDir, r.name), { recursive: true, force: true });
  }
  return runs.length - keepLast;
}

export function closeDb(): void {} // no-op for JSON implementation
