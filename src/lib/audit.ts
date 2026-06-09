import path from 'path';
import { randomUUID } from 'crypto';
import { AUDIT_DIR, AGENTS_DIR } from './data-dir';
import { getAuditProxy } from './audit-proxy';
import { AgentProxy } from './agent-proxy';

export interface AuditEntry {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  resource: string;
  details?: string;
  status: 'success' | 'error';
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
  const entry: AuditEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    agent: params.agent,
    action: params.action,
    resource: params.resource,
    details: params.details || '',
    status: params.status || 'success',
  };

  const proxy = getAuditProxy();
  proxy.addAuditEntry(entry);

  return entry;
}

/**
 * 读取最近的 N 条审计日志
 * 从最新的日期文件向前扫描（支持 .jsonl 和旧版 .json）
 */
export async function readAuditLogs(limit: number = 100): Promise<AuditEntry[]> {
  const proxy = getAuditProxy();
  const results: AuditEntry[] = [];

  // Scan dates from today backwards
  const today = new Date();
  for (let d = 0; d < 30 && results.length < limit; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const dateStr = date.toISOString().slice(0, 10);

    // Use proxy to get logs for this date
    const logs = await proxy.getAuditLogs(dateStr);
    // Logs are in forward order — reverse to get newest first
    for (let i = logs.length - 1; i >= 0 && results.length < limit; i--) {
      results.push(logs[i] as AuditEntry);
    }
  }

  return results;
}

/**
 * 获取指定 Agent 的审计日志
 */
export async function readAgentAuditLogs(agentName: string, limit: number = 50): Promise<AuditEntry[]> {
  const all = await readAuditLogs(limit * 2); // oversample then filter
  return all.filter(e => e.agent === agentName).slice(0, limit);
}

/** Check if agent has a specific permission */
export function checkPermission(agentName: string, permission: string): boolean {
  try {
    const agent = new AgentProxy(agentName);
    // Use cached config (already loaded via agentCache)
    const config = agent.config;
    return (config as any).permissions?.[permission] === true;
  } catch { return false; }
}
