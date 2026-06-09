/**
 * Token Economy — Agent accounts, balances, transfers, task rewards.
 *
 * Storage: .mind/agent-accounts/<agent>.json
 *   { balance, earned, spent, transactions: [{type, amount, from?, to?, task?, timestamp}] }
 *
 * Rules:
 *   - User has unlimited tokens (bypass balance check)
 *   - Group owner分配初始预算
 *   - Tasks can have rewards (quality-dependent)
 *   - Agent-to-agent transfers allowed
 *   - High quality = bonus, low quality = penalty
 */

import fs from 'fs';
import path from 'path';
import { MIND_DIR, AGENTS_DIR } from './data-dir';

const ACCOUNTS_DIR = path.join(MIND_DIR, 'agent-accounts');

function ensureDir() {
  if (!fs.existsSync(ACCOUNTS_DIR)) fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
}

export interface Transaction {
  type: 'deposit' | 'withdraw' | 'transfer_in' | 'transfer_out' | 'reward' | 'penalty' | 'bonus';
  amount: number;
  from?: string;
  to?: string;
  task?: string;
  reason?: string;
  timestamp: number;
}

export interface AgentAccount {
  agent: string;
  balance: number;
  earned: number;
  spent: number;
  transactions: Transaction[];
}

function accountPath(agent: string): string {
  return path.join(ACCOUNTS_DIR, `${agent}.json`);
}

function loadAccount(agent: string): AgentAccount {
  ensureDir();
  const fp = accountPath(agent);
  if (fs.existsSync(fp)) {
    try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch {}
  }
  return { agent, balance: 0, earned: 0, spent: 0, transactions: [] };
}

function saveAccount(account: AgentAccount): void {
  ensureDir();
  const fp = accountPath(account.agent);
  fs.writeFileSync(fp, JSON.stringify(account, null, 2), 'utf-8');
}

/** Deposit tokens to an agent (from user or group owner) */
export function deposit(agent: string, amount: number, from: string, reason?: string): AgentAccount {
  if (amount <= 0) throw new Error('Amount must be positive');
  const account = loadAccount(agent);
  account.balance += amount;
  account.earned += amount;
  account.transactions.push({
    type: 'deposit', amount, from, reason,
    timestamp: Date.now(),
  });
  saveAccount(account);
  return account;
}

/** Withdraw tokens (agent spends on a task) */
export function withdraw(agent: string, amount: number, task: string): boolean {
  if (amount <= 0) return false;
  const account = loadAccount(agent);
  if (account.balance < amount) return false;
  account.balance -= amount;
  account.spent += amount;
  account.transactions.push({
    type: 'withdraw', amount, task,
    timestamp: Date.now(),
  });
  saveAccount(account);
  return true;
}

/** Transfer tokens between agents */
export function transfer(from: string, to: string, amount: number, reason?: string): boolean {
  if (amount <= 0 || from === to) return false;
  const fromAccount = loadAccount(from);
  if (fromAccount.balance < amount) return false;

  const toAccount = loadAccount(to);

  fromAccount.balance -= amount;
  fromAccount.spent += amount;
  fromAccount.transactions.push({
    type: 'transfer_out', amount, to, reason,
    timestamp: Date.now(),
  });

  toAccount.balance += amount;
  toAccount.earned += amount;
  toAccount.transactions.push({
    type: 'transfer_in', amount, from, reason,
    timestamp: Date.now(),
  });

  saveAccount(fromAccount);
  saveAccount(toAccount);
  return true;
}

/** Reward agent for task completion (quality-dependent) */
export function reward(agent: string, amount: number, task: string, quality: 'normal' | 'bonus' = 'normal'): AgentAccount {
  if (amount <= 0) return loadAccount(agent);
  const account = loadAccount(agent);
  account.balance += amount;
  account.earned += amount;
  account.transactions.push({
    type: quality === 'bonus' ? 'bonus' : 'reward', amount, task,
    reason: quality === 'bonus' ? '高质量完成' : '完成任务',
    timestamp: Date.now(),
  });
  saveAccount(account);
  return account;
}

/** Penalize agent for poor quality */
export function penalize(agent: string, amount: number, task: string, reason: string): AgentAccount {
  const account = loadAccount(agent);
  const penalty = Math.min(amount, account.balance); // Can't go negative
  account.balance -= penalty;
  account.transactions.push({
    type: 'penalty', amount: penalty, task, reason,
    timestamp: Date.now(),
  });
  saveAccount(account);
  return account;
}

/** Get agent's current balance */
export function getBalance(agent: string): number {
  return loadAccount(agent).balance;
}

/** Get full account info */
export function getAccount(agent: string): AgentAccount {
  return loadAccount(agent);
}

/** Get all accounts (for leaderboard) */
export function getAllAccounts(): AgentAccount[] {
  ensureDir();
  const files = fs.readdirSync(ACCOUNTS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(ACCOUNTS_DIR, f), 'utf-8')); }
    catch { return null; }
  }).filter(Boolean);
}

/** Get leaderboard sorted by balance */
export function getLeaderboard(): Array<{ agent: string; balance: number; earned: number; tasks: number }> {
  return getAllAccounts()
    .map(a => ({
      agent: a.agent,
      balance: a.balance,
      earned: a.earned,
      tasks: a.transactions.filter(t => t.type === 'reward' || t.type === 'bonus').length,
    }))
    .sort((a, b) => b.balance - a.balance);
}
