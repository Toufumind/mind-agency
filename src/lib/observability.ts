/**
 * Observability data aggregator — consumes existing data sources.
 *
 * L1 — Dashboard activity feed
 * L2 — Token cost analytics
 * L3 — Audit log viewer
 *
 * All data already exists on disk. This module just reads and aggregates.
 */

import fs from 'fs';
import path from 'path';
import { AUDIT_DIR, GROUPS_DIR, AGENTS_DIR, MIND_DIR } from './data-dir';
import { loadIndex, getStats } from './chat-index';

// ── Types ────────────────────────────────────────────────

export interface ActivityEvent {
  type: 'group_message' | 'email' | 'decide' | 'agent_active' | 'agent_idle';
  agent: string;
  group?: string;
  detail: string;
  timestamp: number;
}

export interface CostBreakdown {
  agent: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  calls: number;
}

export interface TimeSeriesPoint {
  label: string;        // hour label "12:00"
  tokens: number;
  cost: number;
  calls: number;
}

export interface DashboardData {
  activity: ActivityEvent[];
  costs: CostBreakdown[];
  todayCost: number;
  weekCost: number;
  totalTokens: number;
  totalCalls: number;
}

// ── Read token data ──────────────────────────────────────

interface TokenRecord { agent: string; tokensIn: number; tokensOut: number; cost: number; timestamp: number; model: string; }

function readTokens(): TokenRecord[] {
  const file = path.join(AUDIT_DIR, 'tokens.jsonl');
  if (!fs.existsSync(file)) return [];
  try {
    return fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
}

// ── Read audit logs ──────────────────────────────────────

interface AuditRecord { agent: string; action: string; resource: string; timestamp: string; details?: string; status?: string; }

function readAudit(limit = 100): AuditRecord[] {
  const dir = AUDIT_DIR;
  if (!fs.existsSync(dir)) return [];
  const today = new Date().toISOString().split('T')[0];
  const todayFile = path.join(dir, `${today}.json`);
  const records: AuditRecord[] = [];
  if (fs.existsSync(todayFile)) {
    try { records.push(...JSON.parse(fs.readFileSync(todayFile, 'utf-8'))); } catch {}
  }
  return records.slice(-limit);
}

// ── L1: Activity feed ────────────────────────────────────

export function getActivityFeed(): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const now = Date.now();
  const oneHour = 3600_000;

  // Agent state (lastCheck timestamps)
  if (fs.existsSync(AGENTS_DIR)) {
    for (const a of fs.readdirSync(AGENTS_DIR, { withFileTypes: true })) {
      if (!a.isDirectory() || a.name.startsWith('.') || a.name === 'me') continue;
      const stateFile = path.join(AGENTS_DIR, a.name, 'chat', 'mind-state.json');
      let lastCheck = 0;
      try { if (fs.existsSync(stateFile)) { const s = JSON.parse(fs.readFileSync(stateFile, 'utf-8')); lastCheck = Math.max(s.emailCheck||0, ...Object.values(s.groups||{}).map((g:any)=>g.chatCheck||0)); } } catch {}
      if (now - lastCheck < 120_000) {
        events.push({ type: 'agent_active', agent: a.name, detail: '刚刚活跃', timestamp: lastCheck });
      } else if (now - lastCheck < oneHour) {
        events.push({ type: 'agent_idle', agent: a.name, detail: `空闲 ${Math.floor((now-lastCheck)/60000)} 分钟`, timestamp: lastCheck });
      }
    }
  }

  // Recent chat messages
  const idx = loadIndex();
  for (const m of idx.messages.slice(0, 10)) {
    if (now - m.timestamp > oneHour) continue;
    const hasMention = m.mentions?.length > 0;
    events.push({
      type: 'group_message',
      agent: m.from,
      group: m.group,
      detail: hasMention ? `@了 ${m.mentions!.join(', ')}: ${m.body.slice(0, 60)}` : m.body.slice(0, 60),
      timestamp: m.timestamp,
    });
  }

  // Recent audit entries
  const audits = readAudit(20);
  for (const a of audits) {
    const ts = new Date(a.timestamp).getTime();
    if (now - ts > oneHour) continue;
    events.push({
      type: a.action.includes('decide') ? 'decide' : a.action.includes('email') ? 'email' : 'agent_active',
      agent: a.agent,
      detail: `${a.action}: ${a.details || a.resource}`,
      timestamp: ts,
    });
  }

  // Sort newest first, dedup
  events.sort((a,b) => b.timestamp - a.timestamp);
  const seen = new Set<string>();
  return events.filter(e => {
    const k = `${e.agent}:${e.detail.slice(0,40)}:${e.timestamp}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  }).slice(0, 20);
}

// ── L2: Cost analytics ────────────────────────────────────

export function getCostAnalytics(): { today: CostBreakdown[]; week: CostBreakdown[]; monthly: CostBreakdown[]; todayTotal: number; weekTotal: number; monthlyTotal: number; totalCalls: number } {
  const tokens = readTokens();
  const now = Date.now();
  const todayMs = 86400_000;
  const weekMs = todayMs * 7;
  const monthMs = todayMs * 30;

  const todayStart = new Date(new Date().toISOString().split('T')[0]).getTime();

  const aggregate = (records: TokenRecord[], cutoff: number) => {
    const map = new Map<string, CostBreakdown>();
    for (const r of records) {
      if (r.timestamp < cutoff) continue;
      const a = map.get(r.agent) || { agent: r.agent, tokensIn: 0, tokensOut: 0, cost: 0, calls: 0 };
      a.tokensIn += r.tokensIn || 0;
      a.tokensOut += r.tokensOut || 0;
      a.cost += r.cost || 0;
      a.calls++;
      map.set(r.agent, a);
    }
    return [...map.values()].sort((a,b) => b.cost - a.cost);
  };

  const today = aggregate(tokens, todayStart);
  const week = aggregate(tokens, now - weekMs);
  const monthly = aggregate(tokens, now - monthMs);

  return {
    today, week, monthly,
    todayTotal: today.reduce((s,c) => s + c.cost, 0),
    weekTotal: week.reduce((s,c) => s + c.cost, 0),
    monthlyTotal: monthly.reduce((s,c) => s + c.cost, 0),
    totalCalls: tokens.length,
  };
}

export function getAuditLogs(agent?: string, limit = 50): AuditRecord[] {
  const logs = readAudit(limit * 2);
  return logs.filter(l => !agent || l.agent.toLowerCase() === agent.toLowerCase()).slice(-limit);
}
