/**
 * LearningProxy — unified learning record management in Next.js process.
 *
 * Consolidates ALL learning logic:
 *   - Learning records (JSONL files)
 *   - Team learnings
 *   - Agent-specific learnings
 *
 * Singleton instance — use getLearningProxy() to access.
 */

import fs from 'fs';
import path from 'path';
import { MIND_DIR, GROUPS_DIR } from './data-dir';

// ── Types ─────────────────────────────────────────────────

export interface LearningRecord {
  timestamp: number;
  agent: string;
  group?: string;
  workflow?: string;
  stepId?: string;
  action: string;
  input?: string;
  output?: string;
  evaluation?: {
    verdict: 'APPROVED' | 'NEEDS_REVISION' | 'REJECTED';
    feedback?: string;
    score?: number;
  };
  tags?: string[];
}

// ── LearningProxy class ───────────────────────────────────

export class LearningProxy {
  private _learningDir: string;
  private _records: Map<string, LearningRecord[]> = new Map();
  private _loaded: Map<string, boolean> = new Map();

  constructor() {
    this._learningDir = path.join(MIND_DIR, 'learning');
  }

  // ── Directory setup ────────────────────────────────────

  private ensureDir(): void {
    if (!fs.existsSync(this._learningDir)) {
      fs.mkdirSync(this._learningDir, { recursive: true });
    }
  }

  // ── Record management ──────────────────────────────────

  /**
   * Get learning records for a group.
   */
  async getGroupRecords(groupName: string): Promise<LearningRecord[]> {
    const cacheKey = `group:${groupName}`;
    if (this._loaded.get(cacheKey)) {
      return this._records.get(cacheKey) || [];
    }

    const records: LearningRecord[] = [];
    try {
      this.ensureDir();
      const logFile = path.join(this._learningDir, `learning-${groupName}.jsonl`);
      if (fs.existsSync(logFile)) {
        const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            records.push(JSON.parse(line));
          } catch {}
        }
      }
    } catch {}

    this._records.set(cacheKey, records);
    this._loaded.set(cacheKey, true);

    return records;
  }

  /**
   * Get learning records for an agent.
   */
  async getAgentRecords(agentName: string): Promise<LearningRecord[]> {
    const allRecords: LearningRecord[] = [];

    // Search all group learning files for this agent's records
    try {
      this.ensureDir();
      const files = fs.readdirSync(this._learningDir).filter(f => f.startsWith('learning-') && f.endsWith('.jsonl'));
      for (const file of files) {
        try {
          const lines = fs.readFileSync(path.join(this._learningDir, file), 'utf-8').split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const record = JSON.parse(line);
              if (record.agent === agentName) {
                allRecords.push(record);
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}

    return allRecords;
  }

  /**
   * Add a learning record.
   */
  async addRecord(groupName: string, record: LearningRecord): Promise<void> {
    try {
      this.ensureDir();
      const logFile = path.join(this._learningDir, `learning-${groupName}.jsonl`);
      fs.appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf-8');

      // Invalidate cache
      const cacheKey = `group:${groupName}`;
      this._records.delete(cacheKey);
      this._loaded.delete(cacheKey);
    } catch (err) {
      console.error(`[learning-proxy] addRecord(${groupName}):`, err);
    }
  }

  /**
   * Search records by query.
   */
  async searchRecords(query: string, groupName?: string): Promise<LearningRecord[]> {
    const records = groupName
      ? await this.getGroupRecords(groupName)
      : await this.getAllRecords();

    const lowerQuery = query.toLowerCase();
    return records.filter(r => {
      const searchable = [
        r.action,
        r.input,
        r.output,
        r.evaluation?.feedback,
        ...(r.tags || []),
      ].filter(Boolean).join(' ').toLowerCase();
      return searchable.includes(lowerQuery);
    });
  }

  /**
   * Get all records across all groups.
   */
  async getAllRecords(): Promise<LearningRecord[]> {
    const allRecords: LearningRecord[] = [];

    try {
      this.ensureDir();
      const files = fs.readdirSync(this._learningDir).filter(f => f.startsWith('learning-') && f.endsWith('.jsonl'));
      for (const file of files) {
        try {
          const lines = fs.readFileSync(path.join(this._learningDir, file), 'utf-8').split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              allRecords.push(JSON.parse(line));
            } catch {}
          }
        } catch {}
      }
    } catch {}

    return allRecords;
  }

  /**
   * Get recent records (last N).
   */
  async getRecentRecords(limit: number = 10, groupName?: string): Promise<LearningRecord[]> {
    const records = groupName
      ? await this.getGroupRecords(groupName)
      : await this.getAllRecords();

    return records.slice(-limit);
  }

  /**
   * Get records by agent and verdict.
   */
  async getRecordsByVerdict(
    agentName: string,
    verdict: 'APPROVED' | 'NEEDS_REVISION' | 'REJECTED'
  ): Promise<LearningRecord[]> {
    const records = await this.getAgentRecords(agentName);
    return records.filter(r => r.evaluation?.verdict === verdict);
  }

  // ── Statistics ─────────────────────────────────────────

  /**
   * Get learning statistics for a group.
   */
  async getGroupStats(groupName: string): Promise<{
    total: number;
    approved: number;
    needsRevision: number;
    rejected: number;
    agents: Record<string, number>;
  }> {
    const records = await this.getGroupRecords(groupName);

    const stats = {
      total: records.length,
      approved: 0,
      needsRevision: 0,
      rejected: 0,
      agents: {} as Record<string, number>,
    };

    for (const record of records) {
      if (record.evaluation?.verdict === 'APPROVED') stats.approved++;
      else if (record.evaluation?.verdict === 'NEEDS_REVISION') stats.needsRevision++;
      else if (record.evaluation?.verdict === 'REJECTED') stats.rejected++;

      stats.agents[record.agent] = (stats.agents[record.agent] || 0) + 1;
    }

    return stats;
  }

  // ── Cleanup ────────────────────────────────────────────

  /**
   * Invalidate cache for a group.
   */
  invalidateCache(groupName?: string): void {
    if (groupName) {
      const cacheKey = `group:${groupName}`;
      this._records.delete(cacheKey);
      this._loaded.delete(cacheKey);
    } else {
      this._records.clear();
      this._loaded.clear();
    }
  }
}

// ── Singleton ─────────────────────────────────────────────

let instance: LearningProxy | null = null;

export function getLearningProxy(): LearningProxy {
  if (!instance) {
    instance = new LearningProxy();
  }
  return instance;
}
