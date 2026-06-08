import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { AUDIT_DIR, AGENTS_DIR } from './data-dir';

export interface AuditEntry {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  resource: string;
  details?: string;
  status: 'success' | 'error';
}



function ensureAuditDir() {
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  }
}

function getAuditDateFile(): string {
  const today = new Date().toISOString().split('T')[0];
  return path.join(AUDIT_DIR, `${today}.jsonl`);
}

/**
 * 写一条审计日志到 .audit/YYYY-MM-DD.jsonl（append-only，避免竞态）
 */
export function writeAudit(params: {
  agent: string;
  action: string;
  resource: string;
  details?: string;
  status?: 'success' | 'error';
}): AuditEntry {
  ensureAuditDir();

  const entry: AuditEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    agent: params.agent,
    action: params.action,
    resource: params.resource,
    details: params.details || '',
    status: params.status || 'success',
  };

  const file = getAuditDateFile();
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(file, line, 'utf-8');

  return entry;
}

/**
 * 读取最近的 N 条审计日志
 * 从最新的日期文件向前扫描（支持 .jsonl 和旧版 .json）
 */
export function readAuditLogs(limit: number = 100): AuditEntry[] {
  if (!fs.existsSync(AUDIT_DIR)) return [];

  const files = fs.readdirSync(AUDIT_DIR)
    .filter(f => (f.endsWith('.jsonl') || f.endsWith('.json')) && !f.startsWith('tokens'))
    .sort()
    .reverse(); // newest first

  const results: AuditEntry[] = [];

  for (const file of files) {
    if (results.length >= limit) break;
    try {
      const raw = fs.readFileSync(path.join(AUDIT_DIR, file), 'utf-8');
      if (file.endsWith('.jsonl')) {
        // JSONL: each line is one entry, newest at bottom — read from bottom
        const lines = raw.split('\n').filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          results.push(JSON.parse(lines[i]));
          if (results.length >= limit) break;
        }
      } else {
        // Legacy JSON array format
        const entries: AuditEntry[] = JSON.parse(raw);
        if (Array.isArray(entries)) {
          for (let i = entries.length - 1; i >= 0; i--) {
            results.push(entries[i]);
            if (results.length >= limit) break;
          }
        }
      }
    } catch { /* skip corrupted files */ }
  }

  return results;
}

/**
 * 获取指定 Agent 的审计日志
 */
export function readAgentAuditLogs(agentName: string, limit: number = 50): AuditEntry[] {
  const all = readAuditLogs(limit * 2); // oversample then filter
  return all.filter(e => e.agent === agentName).slice(0, limit);
}

/** Check if agent has a specific permission */
export function checkPermission(agentName: string, permission: string): boolean {
  try {
    const configPath = path.join(AGENTS_DIR, agentName, 'config.json');
    if (!fs.existsSync(configPath)) return false;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return config.permissions?.[permission] === true;
  } catch { return false; }
}
