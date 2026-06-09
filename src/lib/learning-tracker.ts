/**
 * Learning Tracker — 记录协作模式和效果
 * 
 * 用于后续多agent研究的数据采集
 */

import fs from 'fs';
import path from 'path';
import { MIND_DIR } from './data-dir';

interface CollaborationRecord {
  id: string;
  scenario: string;
  mode: string;
  agents: string[];
  steps: number;
  score: number;
  duration: number;
  timestamp: string;
}

const LEARNING_DIR = path.join(MIND_DIR, 'learning');

function ensureDir() {
  if (!fs.existsSync(LEARNING_DIR)) fs.mkdirSync(LEARNING_DIR, { recursive: true });
}

function recordCollaboration(record: CollaborationRecord): void {
  ensureDir();
  const logFile = path.join(LEARNING_DIR, 'collaboration-log.jsonl');
  fs.appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf-8');
}

function getCollaborationHistory(limit: number = 50): CollaborationRecord[] {
  ensureDir();
  const logFile = path.join(LEARNING_DIR, 'collaboration-log.jsonl');
  if (!fs.existsSync(logFile)) return [];
  const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
  return lines.map(l => JSON.parse(l)).slice(-limit);
}

function getStrategyStats(): Record<string, { count: number; avgScore: number }> {
  const history = getCollaborationHistory(100);
  const stats: Record<string, { count: number; avgScore: number }> = {};
  for (const r of history) {
    if (!stats[r.mode]) stats[r.mode] = { count: 0, avgScore: 0 };
    stats[r.mode].count++;
    stats[r.mode].avgScore = (stats[r.mode].avgScore * (stats[r.mode].count - 1) + r.score) / stats[r.mode].count;
  }
  return stats;
}

export { recordCollaboration, getCollaborationHistory, getStrategyStats };
export type { CollaborationRecord };
