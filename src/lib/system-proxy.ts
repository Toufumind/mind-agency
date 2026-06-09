/**
 * SystemProxy — unified system configuration in Next.js process.
 *
 * Consolidates ALL system-level logic:
 *   - Settings (settings.json)
 *   - Token usage (token-usage.jsonl)
 *   - Audit logs (.audit/)
 *   - Pending approvals
 *
 * Singleton instance — use getSystemProxy() to access.
 */

import fs from 'fs';
import path from 'path';
import { MIND_DIR, AUDIT_DIR, GROUPS_DIR, AGENTS_DIR } from './data-dir';
import { agentCache } from './cache';

// ── Types ─────────────────────────────────────────────────

export interface SystemSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  wsPort?: number;
  pollInterval?: number;
  [key: string]: any;
}

export interface TokenRecord {
  timestamp: number;
  agent: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface TokenSummary {
  totalTokens: number;
  totalCost: number;
  byAgent: Record<string, { tokens: number; cost: number }>;
}

export interface AuditEntry {
  timestamp: string;
  agent: string;
  action: string;
  resource: string;
  details?: string;
  status?: string;
}

export interface PendingApproval {
  approvalId: string;
  runId: string;
  stepId: string;
  agent: string;
  prompt: string;
  group: string;
}

// ── SystemProxy class ─────────────────────────────────────

export class SystemProxy {
  private _settings: SystemSettings = {};
  private _settingsLoaded = false;

  private _tokenRecords: TokenRecord[] = [];
  private _tokenRecordsLoaded = false;

  constructor() {}

  // ── Settings ──────────────────────────────────────────

  get settings(): SystemSettings {
    return this._settings;
  }

  async loadSettings(): Promise<SystemSettings> {
    if (this._settingsLoaded) return this._settings;

    const cached = agentCache.get<SystemSettings>('system', 'settings');
    if (cached) {
      this._settings = cached;
      this._settingsLoaded = true;
      return this._settings;
    }

    try {
      const settingsPath = path.join(MIND_DIR, 'settings.json');
      if (fs.existsSync(settingsPath)) {
        this._settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        agentCache.set('system', 'settings', this._settings);
      }
    } catch {}

    this._settingsLoaded = true;
    return this._settings;
  }

  async saveSettings(): Promise<void> {
    try {
      if (!fs.existsSync(MIND_DIR)) fs.mkdirSync(MIND_DIR, { recursive: true });

      const settingsPath = path.join(MIND_DIR, 'settings.json');
      const tmp = settingsPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this._settings, null, 2), 'utf-8');
      fs.renameSync(tmp, settingsPath);
      agentCache.invalidate('system', 'settings');
    } catch (err) {
      console.error(`[system-proxy] saveSettings:`, err);
    }
  }

  // ── Token Usage ───────────────────────────────────────

  get tokenRecords(): TokenRecord[] {
    return this._tokenRecords;
  }

  async loadTokenRecords(): Promise<TokenRecord[]> {
    if (this._tokenRecordsLoaded) return this._tokenRecords;

    try {
      const tokenFile = path.join(MIND_DIR, 'token-usage.jsonl');
      if (fs.existsSync(tokenFile)) {
        const lines = fs.readFileSync(tokenFile, 'utf-8').split('\n').filter(Boolean);
        this._tokenRecords = lines
          .map(line => {
            try { return JSON.parse(line); } catch { return null; }
          })
          .filter(Boolean);
      }
    } catch {}

    this._tokenRecordsLoaded = true;
    return this._tokenRecords;
  }

  async addTokenRecord(record: TokenRecord): Promise<void> {
    this._tokenRecords.push(record);

    try {
      if (!fs.existsSync(MIND_DIR)) fs.mkdirSync(MIND_DIR, { recursive: true });

      const tokenFile = path.join(MIND_DIR, 'token-usage.jsonl');
      fs.appendFileSync(tokenFile, JSON.stringify(record) + '\n', 'utf-8');
    } catch (err) {
      console.error(`[system-proxy] addTokenRecord:`, err);
    }
  }

  async getTokenSummary(): Promise<TokenSummary> {
    await this.loadTokenRecords();

    const summary: TokenSummary = {
      totalTokens: 0,
      totalCost: 0,
      byAgent: {},
    };

    for (const record of this._tokenRecords) {
      summary.totalTokens += record.inputTokens + record.outputTokens;
      summary.totalCost += record.cost;

      if (!summary.byAgent[record.agent]) {
        summary.byAgent[record.agent] = { tokens: 0, cost: 0 };
      }
      summary.byAgent[record.agent].tokens += record.inputTokens + record.outputTokens;
      summary.byAgent[record.agent].cost += record.cost;
    }

    return summary;
  }

  // ── Audit Logs ────────────────────────────────────────

  async getAuditLogs(date?: string): Promise<AuditEntry[]> {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const auditFile = path.join(AUDIT_DIR, `${targetDate}.jsonl`);

    try {
      if (!fs.existsSync(auditFile)) return [];

      const lines = fs.readFileSync(auditFile, 'utf-8').split('\n').filter(Boolean);
      return lines
        .map(line => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean);
    } catch {}
    return [];
  }

  async addAuditEntry(entry: AuditEntry): Promise<void> {
    try {
      if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });

      const date = entry.timestamp?.slice(0, 10) || new Date().toISOString().slice(0, 10);
      const auditFile = path.join(AUDIT_DIR, `${date}.jsonl`);
      fs.appendFileSync(auditFile, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
      console.error(`[system-proxy] addAuditEntry:`, err);
    }
  }

  // ── Pending Approvals ─────────────────────────────────

  async getPendingApprovals(): Promise<PendingApproval[]> {
    const pending: PendingApproval[] = [];

    try {
      if (!fs.existsSync(GROUPS_DIR)) return pending;

      const groups = fs.readdirSync(GROUPS_DIR, { withFileTypes: true });
      for (const group of groups) {
        if (!group.isDirectory() || group.name.startsWith('.')) continue;

        const pendingDir = path.join(GROUPS_DIR, group.name, '.pending-approvals');
        if (!fs.existsSync(pendingDir)) continue;

        const files = fs.readdirSync(pendingDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(pendingDir, file), 'utf-8'));
            pending.push({
              approvalId: data.approvalId || file.replace('.json', ''),
              runId: data.runId || '',
              stepId: data.stepId || '',
              agent: data.agent || '',
              prompt: data.prompt || '',
              group: group.name,
            });
          } catch {}
        }
      }
    } catch {}

    return pending;
  }

  // ── Agent Accounts (Token Economy) ──────────────────────

  private _accountsDir = path.join(MIND_DIR, 'agent-accounts');

  private ensureAccountsDir(): void {
    if (!fs.existsSync(this._accountsDir)) fs.mkdirSync(this._accountsDir, { recursive: true });
  }

  async loadAgentAccount(agent: string): Promise<any> {
    this.ensureAccountsDir();
    const fp = path.join(this._accountsDir, `${agent}.json`);
    if (fs.existsSync(fp)) {
      try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch {}
    }
    return { agent, balance: 0, earned: 0, spent: 0, transactions: [] };
  }

  async saveAgentAccount(account: any): Promise<void> {
    this.ensureAccountsDir();
    const fp = path.join(this._accountsDir, `${account.agent}.json`);
    fs.writeFileSync(fp, JSON.stringify(account, null, 2), 'utf-8');
  }

  async listAgentAccounts(): Promise<any[]> {
    this.ensureAccountsDir();
    const files = fs.readdirSync(this._accountsDir).filter(f => f.endsWith('.json'));
    return files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(this._accountsDir, f), 'utf-8')); }
      catch { return null; }
    }).filter(Boolean);
  }

  // ── Provider Profiles ───────────────────────────────────

  private _profilesFile = path.join(MIND_DIR, 'provider-profiles.json');

  async loadProviderProfiles(): Promise<any[]> {
    this.ensureDir();
    try {
      if (fs.existsSync(this._profilesFile)) {
        return JSON.parse(fs.readFileSync(this._profilesFile, 'utf-8'));
      }
    } catch {}
    return [];
  }

  async saveProviderProfiles(profiles: any[]): Promise<void> {
    this.ensureDir();
    const tmp = this._profilesFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(profiles, null, 2), 'utf-8');
    fs.renameSync(tmp, this._profilesFile);
  }

  private ensureDir(): void {
    if (!fs.existsSync(MIND_DIR)) fs.mkdirSync(MIND_DIR, { recursive: true });
  }

  // ── Cleanup ───────────────────────────────────────────

  invalidateCache(): void {
    this._settingsLoaded = false;
    this._tokenRecordsLoaded = false;
    agentCache.invalidate('system', 'settings');
  }

  destroy(): void {
    this.invalidateCache();
  }
}

// Singleton instance
let instance: SystemProxy | null = null;

export function getSystemProxy(): SystemProxy {
  if (!instance) {
    instance = new SystemProxy();
  }
  return instance;
}
