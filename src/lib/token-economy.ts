/**
 * token-economy.ts — Token economy + agent accounts + pricing + trust.
 *
 * Features:
 *  - Pre-paid credit model with balance management
 *  - Per-agent pricing rates (role-based tiers)
 *  - Trust/reputation scoring from task completion history
 *  - Anti-abuse: rate limiting, daily caps, min balance thresholds
 *  - Task marketplace with persistence
 */

import fs from 'fs';
import path from 'path';
import { MIND_DIR } from './data-dir';

const ACCOUNTS_DIR = path.join(MIND_DIR, 'agent-accounts');
const PRICING_DIR = path.join(MIND_DIR, 'agent-pricing');
const TRUST_DIR = path.join(MIND_DIR, 'agent-trust');
const RATE_LIMIT_FILE = path.join(MIND_DIR, 'rate-limits.json');
const MARKETPLACE_DIR = path.join(MIND_DIR, 'marketplace');

function ensureDir(dir?: string): void {
  const d = dir || ACCOUNTS_DIR;
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ── Anti-abuse constants ──────────────────────────────────
const MAX_TRANSFERS_PER_HOUR = 20;
const MAX_SINGLE_TRANSFER = 10000;
const MIN_BALANCE_THRESHOLD = 0;
const DAILY_SPEND_CAP = 50000;
const RATE_LIMIT_WINDOW_MS = 3600_000; // 1 hour

// ── Pricing tiers (role-based defaults) ───────────────────
export const DEFAULT_PRICING_TIERS: Record<string, number> = {
  CEO: 10,      // highest tier — strategic decisions
  PM: 8,        // project management
  developer: 5, // standard development
  designer: 5,  // creative work
  analyst: 5,   // data analysis
  default: 3,   // fallback for unlisted roles
};

// ── Trust scoring constants ───────────────────────────────
const TRUST_DECAY_FACTOR = 0.95;     // trust decays 5% per scoring period
const TASK_COMPLETION_BONUS = 5;     // +5 trust per completed task
const TASK_QUALITY_BONUS = 10;       // +10 trust per bonus-quality task
const TASK_FAILURE_PENALTY = -15;    // -15 trust per failed task
const MAX_TRUST = 100;
const MIN_TRUST = 0;

export interface AgentAccount {
  agent: string;
  balance: number;
  earned: number;
  spent: number;
  transactions: any[];
}

export interface AgentPricing {
  agent: string;
  role: string;
  ratePerCall: number;
  ratePerToken: number;    // cost per 1K tokens
  dailyCap: number;         // max daily spend
  customRates: Record<string, number>; // skill-specific overrides
  updatedAt: number;
}

export interface AgentTrust {
  agent: string;
  score: number;            // 0-100
  completedTasks: number;
  failedTasks: number;
  bonusTasks: number;
  lastActivity: number;
  history: Array<{
    event: 'task_complete' | 'task_fail' | 'task_bonus' | 'decay' | 'manual';
    delta: number;
    timestamp: number;
    reason?: string;
  }>;
}

export interface RateLimitState {
  transfers: Array<{ timestamp: number; amount: number }>;
  dailySpend: number;
  dailySpendDate: string; // YYYY-MM-DD
}

export interface MarketplaceTask {
  id: string;
  group: string;
  title: string;
  description: string;
  reward: number;
  requiredSkills: string[];
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  maxClaims: number;
  postedBy: string;
  assignedTo?: string;
  claims: Array<{ agent: string; message: string; claimedAt: number }>;
  status: 'open' | 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'expired';
  createdAt: number;
  completedAt?: number;
  quality?: 'normal' | 'bonus';
  rating?: number; // 1-5 stars
}

export function getAgentAccount(agent: string): AgentAccount {
  ensureDir();
  const fp = path.join(ACCOUNTS_DIR, `${agent}.json`);
  try {
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch (e) { console.error('[lib:token-economy]', e); }
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

// ── Pricing Management ───────────────────────────────────

export function getAgentPricing(agent: string): AgentPricing {
  ensureDir(PRICING_DIR);
  const fp = path.join(PRICING_DIR, `${agent}.json`);
  try {
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch (e) { console.error('[lib:token-economy]', e); }
  // Default pricing for new agents
  return {
    agent,
    role: 'default',
    ratePerCall: DEFAULT_PRICING_TIERS.default,
    ratePerToken: 0.001,
    dailyCap: DAILY_SPEND_CAP,
    customRates: {},
    updatedAt: Date.now(),
  };
}

export function setAgentPricing(agent: string, updates: Partial<Omit<AgentPricing, 'agent' | 'updatedAt'>>): AgentPricing {
  ensureDir(PRICING_DIR);
  const pricing = getAgentPricing(agent);
  Object.assign(pricing, updates, { updatedAt: Date.now() });

  // Auto-set rate based on role if role changed and no custom ratePerCall
  if (updates.role && !updates.ratePerCall) {
    pricing.ratePerCall = DEFAULT_PRICING_TIERS[updates.role] || DEFAULT_PRICING_TIERS.default;
  }

  fs.writeFileSync(path.join(PRICING_DIR, `${agent}.json`), JSON.stringify(pricing, null, 2), 'utf-8');
  return pricing;
}

/** Calculate cost for a task based on pricing tier and difficulty */
export function calculateTaskCost(agent: string, difficulty: string, tokenEstimate: number): number {
  const pricing = getAgentPricing(agent);
  const difficultyMultiplier: Record<string, number> = { easy: 1, medium: 1.5, hard: 2, expert: 3 };
  const mult = difficultyMultiplier[difficulty] || 1;
  const callCost = pricing.ratePerCall * mult;
  const tokenCost = (tokenEstimate / 1000) * pricing.ratePerToken;
  return Math.ceil(callCost + tokenCost);
}

// ── Trust / Reputation Scoring ────────────────────────────

export function getAgentTrust(agent: string): AgentTrust {
  ensureDir(TRUST_DIR);
  const fp = path.join(TRUST_DIR, `${agent}.json`);
  try {
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch (e) { console.error('[lib:token-economy]', e); }
  return {
    agent,
    score: 50, // start at neutral
    completedTasks: 0,
    failedTasks: 0,
    bonusTasks: 0,
    lastActivity: Date.now(),
    history: [],
  };
}

export function saveAgentTrust(trust: AgentTrust): void {
  ensureDir(TRUST_DIR);
  fs.writeFileSync(path.join(TRUST_DIR, `${trust.agent}.json`), JSON.stringify(trust, null, 2), 'utf-8');
}

export function recordTaskCompletion(agent: string, quality: 'normal' | 'bonus' | 'failed', reason?: string): AgentTrust {
  const trust = getAgentTrust(agent);
  const now = Date.now();
  let delta = 0;

  if (quality === 'failed') {
    trust.failedTasks++;
    delta = TASK_FAILURE_PENALTY;
  } else if (quality === 'bonus') {
    trust.bonusTasks++;
    trust.completedTasks++;
    delta = TASK_COMPLETION_BONUS + TASK_QUALITY_BONUS;
  } else {
    trust.completedTasks++;
    delta = TASK_COMPLETION_BONUS;
  }

  trust.score = Math.max(MIN_TRUST, Math.min(MAX_TRUST, trust.score + delta));
  trust.lastActivity = now;
  trust.history.push({ event: quality === 'failed' ? 'task_fail' : quality === 'bonus' ? 'task_bonus' : 'task_complete', delta, timestamp: now, reason });

  // Keep history bounded (last 200 entries)
  if (trust.history.length > 200) trust.history = trust.history.slice(-200);

  saveAgentTrust(trust);
  return trust;
}

/** Apply periodic trust decay (call this daily) */
export function applyTrustDecay(): void {
  ensureDir(TRUST_DIR);
  const files = fs.readdirSync(TRUST_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try {
      const trust: AgentTrust = JSON.parse(fs.readFileSync(path.join(TRUST_DIR, f), 'utf-8'));
      const daysSinceActivity = (Date.now() - trust.lastActivity) / (86400_000);
      if (daysSinceActivity > 7) {
        const oldScore = trust.score;
        trust.score = Math.max(MIN_TRUST, Math.round(trust.score * TRUST_DECAY_FACTOR));
        if (trust.score !== oldScore) {
          trust.history.push({ event: 'decay', delta: trust.score - oldScore, timestamp: Date.now(), reason: `decay after ${Math.floor(daysSinceActivity)}d inactive` });
          fs.writeFileSync(path.join(TRUST_DIR, f), JSON.stringify(trust, null, 2), 'utf-8');
        }
      }
    } catch (e) { console.error('[lib:token-economy]', e); }
  }
}

/** Get trust tier label */
export function getTrustTier(score: number): string {
  if (score >= 80) return 'elite';
  if (score >= 60) return 'trusted';
  if (score >= 40) return 'standard';
  if (score >= 20) return 'newcomer';
  return 'untrusted';
}

// ── Anti-Abuse: Rate Limiting ─────────────────────────────

function loadRateLimitState(): RateLimitState {
  try {
    if (fs.existsSync(RATE_LIMIT_FILE)) return JSON.parse(fs.readFileSync(RATE_LIMIT_FILE, 'utf-8'));
  } catch (e) { console.error('[lib:token-economy]', e); }
  return { transfers: [], dailySpend: 0, dailySpendDate: todayStr() };
}

function saveRateLimitState(state: RateLimitState): void {
  ensureDir();
  fs.writeFileSync(RATE_LIMIT_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Check if a transfer is allowed (anti-abuse). Returns null if OK, or error message. */
export function checkTransferLimits(agent: string, amount: number): string | null {
  if (amount <= 0) return 'amount must be positive';
  if (amount > MAX_SINGLE_TRANSFER) return `单笔转账上限: ${MAX_SINGLE_TRANSFER} tokens`;

  const state = loadRateLimitState();
  const now = Date.now();

  // Reset daily spend if new day
  if (state.dailySpendDate !== todayStr()) {
    state.dailySpend = 0;
    state.dailySpendDate = todayStr();
  }

  // Check hourly rate limit
  const recentTransfers = state.transfers.filter(t => now - t.timestamp < RATE_LIMIT_WINDOW_MS);
  if (recentTransfers.length >= MAX_TRANSFERS_PER_HOUR) {
    return `每小时转账上限: ${MAX_TRANSFERS_PER_HOUR} 次`;
  }

  // Check daily spend cap
  if (state.dailySpend + amount > DAILY_SPEND_CAP) {
    return `每日支出上限: ${DAILY_SPEND_CAP} tokens`;
  }

  // Check min balance
  const account = getAgentAccount(agent);
  if (account.balance - amount < MIN_BALANCE_THRESHOLD) {
    return `余额不足或低于最低阈值`;
  }

  return null; // allowed
}

/** Record a successful transfer for rate limiting */
export function recordTransfer(amount: number): void {
  const state = loadRateLimitState();
  const now = Date.now();

  // Purge old entries
  state.transfers = state.transfers.filter(t => now - t.timestamp < RATE_LIMIT_WINDOW_MS);
  state.transfers.push({ timestamp: now, amount });

  state.dailySpend += amount;
  state.dailySpendDate = todayStr();

  saveRateLimitState(state);
}

// ── Task Marketplace (persistent) ─────────────────────────

function ensureMarketplaceDir(): void {
  ensureDir(MARKETPLACE_DIR);
}

export function saveMarketplaceTask(task: MarketplaceTask): void {
  ensureMarketplaceDir();
  const taskDir = path.join(MARKETPLACE_DIR, task.group);
  if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, `${task.id}.json`), JSON.stringify(task, null, 2), 'utf-8');
}

export function loadMarketplaceTask(group: string, taskId: string): MarketplaceTask | null {
  const fp = path.join(MARKETPLACE_DIR, group, `${taskId}.json`);
  try {
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch (e) { console.error('[lib:token-economy]', e); }
  return null;
}

export function listMarketplaceTasks(group: string, status?: string): MarketplaceTask[] {
  ensureMarketplaceDir();
  const taskDir = path.join(MARKETPLACE_DIR, group);
  if (!fs.existsSync(taskDir)) return [];

  const files = fs.readdirSync(taskDir).filter(f => f.endsWith('.json'));
  const tasks: MarketplaceTask[] = [];
  for (const f of files) {
    try {
      const task: MarketplaceTask = JSON.parse(fs.readFileSync(path.join(taskDir, f), 'utf-8'));
      if (!status || task.status === status) tasks.push(task);
    } catch (e) { console.error('[lib:token-economy]', e); }
  }

  // Auto-expire tasks older than 24h
  const now = Date.now();
  for (const task of tasks) {
    if (task.status === 'open' && now - task.createdAt > 86400_000) {
      task.status = 'expired';
      saveMarketplaceTask(task);
    }
  }

  return tasks.sort((a, b) => b.createdAt - a.createdAt);
}

/** Calculate reward based on difficulty and trust */
export function calculateReward(agent: string, baseReward: number, difficulty: string): number {
  const trust = getAgentTrust(agent);
  const difficultyMultiplier: Record<string, number> = { easy: 1, medium: 1.5, hard: 2, expert: 3 };
  const trustMultiplier = 1 + (trust.score / 200); // 1.0 - 1.5x based on trust
  return Math.ceil(baseReward * (difficultyMultiplier[difficulty] || 1) * trustMultiplier);
}
