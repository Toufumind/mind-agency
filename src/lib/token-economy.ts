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
 *
 * Uses SystemProxy for file system access.
 */

import { getSystemProxy } from './system-proxy';

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

async function loadAccount(agent: string): Promise<AgentAccount> {
  const proxy = getSystemProxy();
  return proxy.loadAgentAccount(agent);
}

async function saveAccount(account: AgentAccount): Promise<void> {
  const proxy = getSystemProxy();
  await proxy.saveAgentAccount(account);
}

/** Deposit tokens to an agent (from user or group owner) */
export async function deposit(agent: string, amount: number, from: string, reason?: string): Promise<AgentAccount> {
  if (amount <= 0) throw new Error('Amount must be positive');
  const account = await loadAccount(agent);
  account.balance += amount;
  account.earned += amount;
  account.transactions.push({
    type: 'deposit', amount, from, reason,
    timestamp: Date.now(),
  });
  await saveAccount(account);
  return account;
}

/** Withdraw tokens (agent spends on a task) */
export async function withdraw(agent: string, amount: number, task: string): Promise<boolean> {
  if (amount <= 0) return false;
  const account = await loadAccount(agent);
  if (account.balance < amount) return false;
  account.balance -= amount;
  account.spent += amount;
  account.transactions.push({
    type: 'withdraw', amount, task,
    timestamp: Date.now(),
  });
  await saveAccount(account);
  return true;
}

/** Transfer tokens between agents */
export async function transfer(from: string, to: string, amount: number, reason?: string): Promise<boolean> {
  if (amount <= 0 || from === to) return false;
  const fromAccount = await loadAccount(from);
  if (fromAccount.balance < amount) return false;

  const toAccount = await loadAccount(to);

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

  await saveAccount(fromAccount);
  await saveAccount(toAccount);
  return true;
}

/** Reward agent for task completion (quality-dependent) */
export async function reward(agent: string, amount: number, task: string, quality: 'normal' | 'bonus' = 'normal'): Promise<AgentAccount> {
  if (amount <= 0) return loadAccount(agent);
  const account = await loadAccount(agent);
  account.balance += amount;
  account.earned += amount;
  account.transactions.push({
    type: quality === 'bonus' ? 'bonus' : 'reward', amount, task,
    reason: quality === 'bonus' ? '高质量完成' : '完成任务',
    timestamp: Date.now(),
  });
  await saveAccount(account);
  return account;
}

/** Penalize agent for poor quality */
export async function penalize(agent: string, amount: number, task: string, reason: string): Promise<AgentAccount> {
  const account = await loadAccount(agent);
  const penalty = Math.min(amount, account.balance); // Can't go negative
  account.balance -= penalty;
  account.transactions.push({
    type: 'penalty', amount: penalty, task, reason,
    timestamp: Date.now(),
  });
  await saveAccount(account);
  return account;
}

/** Get agent's current balance */
export async function getBalance(agent: string): Promise<number> {
  const account = await loadAccount(agent);
  return account.balance;
}

/** Get full account info */
export async function getAccount(agent: string): Promise<AgentAccount> {
  return loadAccount(agent);
}

/** Get all accounts (for leaderboard) */
export async function getAllAccounts(): Promise<AgentAccount[]> {
  const proxy = getSystemProxy();
  return proxy.listAgentAccounts();
}

/** Get leaderboard sorted by balance */
export async function getLeaderboard(): Promise<Array<{ agent: string; balance: number; earned: number; tasks: number }>> {
  const accounts = await getAllAccounts();
  return accounts
    .map(a => ({
      agent: a.agent,
      balance: a.balance,
      earned: a.earned,
      tasks: a.transactions.filter(t => t.type === 'reward' || t.type === 'bonus').length,
    }))
    .sort((a, b) => b.balance - a.balance);
}
