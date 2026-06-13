/**
 * ScoringProxy — unified scoring system management in Next.js process.
 *
 * Consolidates ALL scoring logic:
 *   - Score records
 *   - Agent rankings
 *   - Group statistics
 *
 * Singleton instance — use getScoringProxy() to access.
 */

import fs from 'fs';
import path from 'path';
import { MIND_DIR, GROUPS_DIR } from './data-dir';

// ── Types ─────────────────────────────────────────────────

export interface ScoreRecord {
  timestamp: number;
  agent: string;
  group: string;
  workflow?: string;
  stepId?: string;
  score: number;
  maxScore: number;
  reason?: string;
  evaluator?: string;
}

export interface AgentRanking {
  agent: string;
  totalScore: number;
  totalMaxScore: number;
  averageScore: number;
  taskCount: number;
}

// ── ScoringProxy class ────────────────────────────────────

export class ScoringProxy {
  private _scoringDir: string;
  private _records: Map<string, ScoreRecord[]> = new Map();
  private _loaded: Map<string, boolean> = new Map();

  constructor() {
    this._scoringDir = path.join(MIND_DIR, 'scoring');
  }

  // ── Directory setup ────────────────────────────────────

  private ensureDir(): void {
    if (!fs.existsSync(this._scoringDir)) {
      fs.mkdirSync(this._scoringDir, { recursive: true });
    }
  }

  // ── Record management ──────────────────────────────────

  /**
   * Get scoring records for a group.
   */
  async getGroupRecords(groupName: string): Promise<ScoreRecord[]> {
    const cacheKey = `group:${groupName}`;
    if (this._loaded.get(cacheKey)) {
      return this._records.get(cacheKey) || [];
    }

    const records: ScoreRecord[] = [];
    try {
      this.ensureDir();
      const logFile = path.join(this._scoringDir, `scores-${groupName}.jsonl`);
      if (fs.existsSync(logFile)) {
        const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            records.push(JSON.parse(line));
          } catch (e) { console.error('[lib:scoring-proxy]', e); }
        }
      }
    } catch (e) { console.error('[lib:scoring-proxy]', e); }

    this._records.set(cacheKey, records);
    this._loaded.set(cacheKey, true);

    return records;
  }

  /**
   * Get scoring records for an agent.
   */
  async getAgentRecords(agentName: string): Promise<ScoreRecord[]> {
    const allRecords: ScoreRecord[] = [];

    try {
      this.ensureDir();
      const files = fs.readdirSync(this._scoringDir).filter(f => f.startsWith('scores-') && f.endsWith('.jsonl'));
      for (const file of files) {
        try {
          const lines = fs.readFileSync(path.join(this._scoringDir, file), 'utf-8').split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const record = JSON.parse(line);
              if (record.agent === agentName) {
                allRecords.push(record);
              }
            } catch (e) { console.error('[lib:scoring-proxy]', e); }
          }
        } catch (e) { console.error('[lib:scoring-proxy]', e); }
      }
    } catch (e) { console.error('[lib:scoring-proxy]', e); }

    return allRecords;
  }

  /**
   * Add a scoring record.
   */
  async addRecord(record: ScoreRecord): Promise<void> {
    try {
      this.ensureDir();
      const logFile = path.join(this._scoringDir, `scores-${record.group}.jsonl`);
      fs.appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf-8');

      // Invalidate cache
      const cacheKey = `group:${record.group}`;
      this._records.delete(cacheKey);
      this._loaded.delete(cacheKey);
    } catch (err) {
      console.error(`[scoring-proxy] addRecord:`, err);
    }
  }

  // ── Rankings ───────────────────────────────────────────

  /**
   * Get agent rankings for a group.
   */
  async getGroupRankings(groupName: string): Promise<AgentRanking[]> {
    const records = await this.getGroupRecords(groupName);

    const agentStats = new Map<string, {
      totalScore: number;
      totalMaxScore: number;
      taskCount: number;
    }>();

    for (const record of records) {
      const stats = agentStats.get(record.agent) || { totalScore: 0, totalMaxScore: 0, taskCount: 0 };
      stats.totalScore += record.score;
      stats.totalMaxScore += record.maxScore;
      stats.taskCount += 1;
      agentStats.set(record.agent, stats);
    }

    const rankings: AgentRanking[] = [];
    for (const [agent, stats] of agentStats) {
      rankings.push({
        agent,
        totalScore: stats.totalScore,
        totalMaxScore: stats.totalMaxScore,
        averageScore: stats.totalMaxScore > 0 ? stats.totalScore / stats.totalMaxScore : 0,
        taskCount: stats.taskCount,
      });
    }

    // Sort by average score descending
    rankings.sort((a, b) => b.averageScore - a.averageScore);

    return rankings;
  }

  /**
   * Get global rankings across all groups.
   */
  async getGlobalRankings(): Promise<AgentRanking[]> {
    const allRecords = await this.getAllRecords();

    const agentStats = new Map<string, {
      totalScore: number;
      totalMaxScore: number;
      taskCount: number;
    }>();

    for (const record of allRecords) {
      const stats = agentStats.get(record.agent) || { totalScore: 0, totalMaxScore: 0, taskCount: 0 };
      stats.totalScore += record.score;
      stats.totalMaxScore += record.maxScore;
      stats.taskCount += 1;
      agentStats.set(record.agent, stats);
    }

    const rankings: AgentRanking[] = [];
    for (const [agent, stats] of agentStats) {
      rankings.push({
        agent,
        totalScore: stats.totalScore,
        totalMaxScore: stats.totalMaxScore,
        averageScore: stats.totalMaxScore > 0 ? stats.totalScore / stats.totalMaxScore : 0,
        taskCount: stats.taskCount,
      });
    }

    rankings.sort((a, b) => b.averageScore - a.averageScore);

    return rankings;
  }

  /**
   * Get all records across all groups.
   */
  async getAllRecords(): Promise<ScoreRecord[]> {
    const allRecords: ScoreRecord[] = [];

    try {
      this.ensureDir();
      const files = fs.readdirSync(this._scoringDir).filter(f => f.startsWith('scores-') && f.endsWith('.jsonl'));
      for (const file of files) {
        try {
          const lines = fs.readFileSync(path.join(this._scoringDir, file), 'utf-8').split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              allRecords.push(JSON.parse(line));
            } catch (e) { console.error('[lib:scoring-proxy]', e); }
          }
        } catch (e) { console.error('[lib:scoring-proxy]', e); }
      }
    } catch (e) { console.error('[lib:scoring-proxy]', e); }

    return allRecords;
  }

  // ── Statistics ─────────────────────────────────────────

  /**
   * Get scoring statistics for a group.
   */
  async getGroupStats(groupName: string): Promise<{
    totalRecords: number;
    averageScore: number;
    highestScore: number;
    lowestScore: number;
    agentCount: number;
  }> {
    const records = await this.getGroupRecords(groupName);

    if (records.length === 0) {
      return {
        totalRecords: 0,
        averageScore: 0,
        highestScore: 0,
        lowestScore: 0,
        agentCount: 0,
      };
    }

    const agents = new Set(records.map(r => r.agent));
    const scores = records.map(r => r.maxScore > 0 ? r.score / r.maxScore : 0);

    return {
      totalRecords: records.length,
      averageScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      highestScore: Math.max(...scores),
      lowestScore: Math.min(...scores),
      agentCount: agents.size,
    };
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

let instance: ScoringProxy | null = null;

export function getScoringProxy(): ScoringProxy {
  if (!instance) {
    instance = new ScoringProxy();
  }
  return instance;
}
