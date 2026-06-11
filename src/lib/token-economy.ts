/**
 * token-economy.ts — Token economy + agent accounts.
 * Extracted from SystemProxy for single responsibility.
 */

import fs from 'fs';
import path from 'path';
import { MIND_DIR } from './data-dir';

const ACCOUNTS_DIR = path.join(MIND_DIR, 'agent-accounts');

function ensureDir(): void {
  if (!fs.existsSync(ACCOUNTS_DIR)) fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
}

export interface AgentAccount {
  agent: string;
  balance: number;
  earned: number;
  spent: number;
  transactions: any[];
}

export function getAgentAccount(agent: string): AgentAccount {
  ensureDir();
  const fp = path.join(ACCOUNTS_DIR, `${agent}.json`);
  try {
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch {}
  return { agent, balance: 0, earned: 0, spent: 0, transactions: [] };
}

export function saveAgentAccount(account: AgentAccount): void {
  ensureDir();
  const fp = path.join(ACCOUNTS_DIR, `${account.agent}.json`);
  fs.writeFileSync(fp, JSON.stringify(account, null, 2), 'utf-8');
}

export function listAgentAccounts(): AgentAccount[] {
  ensureDir();
  const files = fs.readdirSync(ACCOUNTS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(ACCOUNTS_DIR, f), 'utf-8')); }
    catch { return null; }
  }).filter(Boolean);
}
