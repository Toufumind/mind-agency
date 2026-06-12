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

/** Get balance for an agent */
export function getBalance(agent: string): number {
  return getAgentAccount(agent).balance;
}

/** Transfer tokens from one agent to another */
export function transfer(from: string, to: string, amount: number, reason?: string): boolean {
  if (amount <= 0) return false;

  const fromAccount = getAgentAccount(from);
  const toAccount = getAgentAccount(to);

  if (fromAccount.balance < amount) return false;

  fromAccount.balance -= amount;
  fromAccount.spent += amount;
  fromAccount.transactions.push({ type: 'transfer-out', to, amount, reason, timestamp: Date.now() });

  toAccount.balance += amount;
  toAccount.earned += amount;
  toAccount.transactions.push({ type: 'transfer-in', from, amount, reason, timestamp: Date.now() });

  saveAgentAccount(fromAccount);
  saveAgentAccount(toAccount);
  return true;
}

/** Deposit tokens to an agent */
export function deposit(agent: string, amount: number, reason?: string): number {
  if (amount <= 0) return 0;
  const account = getAgentAccount(agent);
  account.balance += amount;
  account.earned += amount;
  account.transactions.push({ type: 'deposit', amount, reason, timestamp: Date.now() });
  saveAgentAccount(account);
  return account.balance;
}

/** Get leaderboard sorted by balance */
export function getLeaderboard(): AgentAccount[] {
  return listAgentAccounts().sort((a, b) => b.balance - a.balance);
}

/** Reward tokens to an agent */
export function reward(agent: string, amount: number, task?: string, quality: 'normal' | 'bonus' = 'normal'): AgentAccount {
  if (amount <= 0) return getAgentAccount(agent);
  const account = getAgentAccount(agent);
  const actualAmount = quality === 'bonus' ? amount * 1.5 : amount;
  account.balance += actualAmount;
  account.earned += actualAmount;
  account.transactions.push({
    type: 'reward',
    amount: actualAmount,
    task,
    quality,
    timestamp: Date.now(),
  });
  saveAgentAccount(account);
  return account;
}

/** Withdraw tokens from an agent (penalty) */
export function withdraw(agent: string, amount: number, reason?: string): AgentAccount {
  if (amount <= 0) return getAgentAccount(agent);
  const account = getAgentAccount(agent);
  account.balance = Math.max(0, account.balance - amount);
  account.spent += amount;
  account.transactions.push({
    type: 'withdraw',
    amount,
    reason,
    timestamp: Date.now(),
  });
  saveAgentAccount(account);
  return account;
}

/** Penalize an agent (alias for withdraw) */
export function penalize(agent: string, amount: number, reason?: string): AgentAccount {
  return withdraw(agent, amount, reason);
}
