/**
 * AuditProxy — unified audit log management in Next.js process.
 *
 * Consolidates ALL audit logic:
 *   - Audit log reading (.audit/<date>.jsonl)
 *   - Audit entry writing
 *   - Date-based log organization
 *
 * Singleton instance — use getAuditProxy() to access.
 */

import fs from 'fs';
import path from 'path';
import { AUDIT_DIR } from './data-dir';

// ── Types ─────────────────────────────────────────────────

export interface AuditEntry {
  timestamp: string;
  agent: string;
  action: string;
  resource: string;
  details?: string;
  status?: string;
}

// ── AuditProxy class ──────────────────────────────────────

export class AuditProxy {
  private _logCache: Map<string, AuditEntry[]> = new Map();
  private _loaded: Map<string, boolean> = new Map();

  constructor() {}

  // ── Read Logs ────────────────────────────────────────

  /**
   * Get audit logs for a specific date.
   * Defaults to today if no date is provided.
   */
  async getAuditLogs(date?: string): Promise<AuditEntry[]> {
    const targetDate = date || new Date().toISOString().slice(0, 10);

    if (this._loaded.get(targetDate)) {
      return this._logCache.get(targetDate) || [];
    }

    const entries: AuditEntry[] = [];
    try {
      const auditFile = path.join(AUDIT_DIR, `${targetDate}.jsonl`);
      if (!fs.existsSync(auditFile)) {
        this._logCache.set(targetDate, entries);
        this._loaded.set(targetDate, true);
        return entries;
      }

      const lines = fs.readFileSync(auditFile, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch {}
      }
    } catch {}

    this._logCache.set(targetDate, entries);
    this._loaded.set(targetDate, true);
    return entries;
  }

  // ── Write Logs ───────────────────────────────────────

  /**
   * Add an audit entry.
   */
  async addAuditEntry(entry: AuditEntry): Promise<void> {
    try {
      if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });

      const date = entry.timestamp?.slice(0, 10) || new Date().toISOString().slice(0, 10);
      const auditFile = path.join(AUDIT_DIR, `${date}.jsonl`);
      fs.appendFileSync(auditFile, JSON.stringify(entry) + '\n', 'utf-8');

      // Invalidate cache for this date
      this._logCache.delete(date);
      this._loaded.delete(date);
    } catch (err) {
      console.error(`[audit-proxy] addAuditEntry:`, err);
    }
  }

  // ── Cleanup ──────────────────────────────────────────

  /**
   * Invalidate audit log cache for a date.
   */
  invalidateCache(date?: string): void {
    if (date) {
      this._logCache.delete(date);
      this._loaded.delete(date);
    } else {
      this._logCache.clear();
      this._loaded.clear();
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this._logCache.clear();
    this._loaded.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────

let instance: AuditProxy | null = null;

export function getAuditProxy(): AuditProxy {
  if (!instance) {
    instance = new AuditProxy();
  }
  return instance;
}
