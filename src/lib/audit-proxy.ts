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
import { BaseProxy, createSingleton } from './base-proxy';

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

export class AuditProxy extends BaseProxy {
  constructor() { super('audit'); }

  // ── Read Logs ────────────────────────────────────────

  async getAuditLogs(date?: string): Promise<AuditEntry[]> {
    const targetDate = date || new Date().toISOString().slice(0, 10);

    const cached = this.cacheGet<AuditEntry[]>(targetDate);
    if (cached) return cached;

    const entries: AuditEntry[] = [];
    try {
      const auditFile = path.join(AUDIT_DIR, `${targetDate}.jsonl`);
      if (!fs.existsSync(auditFile)) {
        this.cacheSet(targetDate, entries);
        return entries;
      }

      const lines = fs.readFileSync(auditFile, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch (err) {
          console.warn(`[audit-proxy] Failed to parse audit line:`, err);
        }
      }
    } catch (err) {
      console.warn(`[audit-proxy] Failed to load audit logs for ${targetDate}:`, err);
    }

    this.cacheSet(targetDate, entries);
    return entries;
  }

  // ── Write Logs ───────────────────────────────────────

  async addAuditEntry(entry: AuditEntry): Promise<void> {
    try {
      if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });

      const date = entry.timestamp?.slice(0, 10) || new Date().toISOString().slice(0, 10);
      const auditFile = path.join(AUDIT_DIR, `${date}.jsonl`);
      fs.appendFileSync(auditFile, JSON.stringify(entry) + '\n', 'utf-8');

      this.cacheInvalidate(date);
    } catch (err) {
      console.error(`[audit-proxy] addAuditEntry:`, err);
    }
  }

  // ── Cleanup ──────────────────────────────────────────

  invalidateCache(date?: string): void {
    if (date) {
      this.cacheInvalidate(date);
    } else {
      this.cacheInvalidateAll();
    }
  }
}

// ── Singleton ─────────────────────────────────────────────

export const getAuditProxy = createSingleton(AuditProxy);
