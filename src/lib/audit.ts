import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export interface AuditEntry {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  resource: string;
  details?: string;
  status: 'success' | 'error';
}

const AUDIT_DIR = path.join(process.cwd(), '.audit');

function ensureAuditDir() {
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  }
}

function getAuditDateFile(): string {
  const today = new Date().toISOString().split('T')[0];
  return path.join(AUDIT_DIR, `${today}.json`);
}

/**
 * 写一条审计日志到 .audit/YYYY-MM-DD.json
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
  let entries: AuditEntry[] = [];
  if (fs.existsSync(file)) {
    try {
      entries = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (!Array.isArray(entries)) entries = [];
    } catch {
      entries = [];
    }
  }
  entries.push(entry);
  fs.writeFileSync(file, JSON.stringify(entries, null, 2), 'utf-8');

  return entry;
}

/**
 * 读取最近的 N 条审计日志
 * 从最新的日期文件向前扫描
 */
export function readAuditLogs(limit: number = 100): AuditEntry[] {
  if (!fs.existsSync(AUDIT_DIR)) return [];

  const files = fs.readdirSync(AUDIT_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse(); // newest first

  const results: AuditEntry[] = [];

  for (const file of files) {
    if (results.length >= limit) break;
    try {
      const entries: AuditEntry[] = JSON.parse(
        fs.readFileSync(path.join(AUDIT_DIR, file), 'utf-8')
      );
      // Each file has entries oldest-first; we want newest-first overall
      for (let i = entries.length - 1; i >= 0; i--) {
        results.push(entries[i]);
        if (results.length >= limit) break;
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

/**
 * 读取代理配置文件，获取权限信息
 */
export function loadAgentConfig(agentName: string): {
  autoRespondToEmail: boolean;
  autoProcessGroupInvites?: boolean;
  roles?: string[];
  permissions?: {
    canCreateGroup?: boolean;
    canDeleteGroup?: boolean;
    canDeploy?: boolean;
  };
} | null {
  const configPath = path.join(process.cwd(), 'Agents', agentName, 'config.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 检查 Agent 是否有指定权限
 */
export function checkPermission(agentName: string, permission: 'canCreateGroup' | 'canDeleteGroup' | 'canDeploy'): boolean {
  const config = loadAgentConfig(agentName);
  if (!config?.permissions) return false;
  return config.permissions[permission] === true;
}
