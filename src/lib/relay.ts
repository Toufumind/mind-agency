/**
 * relay.ts — Professional AI API relay proxy
 *
 * Architecture: Agent → Relay → RAG → AI Provider
 *
 * Features (inspired by one-api/new-api):
 * - Per-agent API key management
 * - Request/response logging
 * - Token counting with per-model pricing
 * - Balance management (prepaid credits)
 * - Rate limiting per agent
 * - Model routing to different providers
 * - Error retry with exponential backoff
 * - Usage analytics
 */

import fs from 'fs';
import path from 'path';
import { MIND_DIR, AGENTS_DIR, getApiBase } from './data-dir';
import { searchMemory } from './memory';
import { getAgentAccount, saveAgentAccount } from './token-economy';

// ── Types ────────────────────────────────────────────────

export interface RelayRequest {
  agent: string;
  messages: Array<{ role: string; content: string }>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface RelayResponse {
  content: string;
  usage: { tokensIn: number; tokensOut: number; cost: number };
  balance: number;
  model: string;
  latencyMs: number;
}

interface RelayLog {
  timestamp: number;
  agent: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  latencyMs: number;
  status: 'success' | 'error';
  error?: string;
}

// ── Pricing (CNY per 1M tokens) ──────────────────────────

const PRICING: Record<string, { input: number; output: number }> = {
  // DeepSeek
  'deepseek-v4-pro': { input: 3.0, output: 6.0 },
  'deepseek-v4-chat': { input: 1.0, output: 2.0 },
  'deepseek-v4-flash': { input: 1.0, output: 2.0 },
  'deepseek-chat': { input: 1.0, output: 2.0 },
  // Claude
  'claude-opus': { input: 108, output: 540 },
  'claude-sonnet': { input: 21.6, output: 108 },
  'claude-haiku': { input: 3.6, output: 18 },
  // OpenAI
  'gpt-4o': { input: 18, output: 72 },
  'gpt-4o-mini': { input: 1.08, output: 4.32 },
  // Default
  'default': { input: 3.0, output: 6.0 },
};

function getModelPricing(model: string): { input: number; output: number } {
  const lower = model.toLowerCase();
  for (const [key, price] of Object.entries(PRICING)) {
    if (lower.includes(key)) return price;
  }
  return PRICING.default;
}

// ── Rate Limiter ─────────────────────────────────────────

const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60; // requests per minute
const RATE_WINDOW = 60_000;

function checkRateLimit(agent: string): boolean {
  const now = Date.now();
  const limit = rateLimits.get(agent);
  if (!limit || now > limit.resetAt) {
    rateLimits.set(agent, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (limit.count >= RATE_LIMIT) return false;
  limit.count++;
  return true;
}

// ── Relay Log ────────────────────────────────────────────

const LOG_DIR = path.join(MIND_DIR, 'relay-logs');
const MAX_LOG_SIZE = 10_000; // max entries per file

function writeLog(entry: RelayLog): void {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const date = new Date(entry.timestamp).toISOString().slice(0, 10);
    const logFile = path.join(LOG_DIR, `${date}.jsonl`);

    // Rotate if too large
    if (fs.existsSync(logFile)) {
      const size = fs.statSync(logFile).size;
      if (size > 5 * 1024 * 1024) { // 5MB
        fs.renameSync(logFile, logFile + '.bak');
      }
    }

    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (e) { console.error('[lib:relay]', e); }
}

function readLogs(date?: string, limit = 100): RelayLog[] {
  try {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const logFile = path.join(LOG_DIR, `${targetDate}.jsonl`);
    if (!fs.existsSync(logFile)) return [];
    const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// ── RAG: Search relevant context ─────────────────────────

async function ragSearch(agent: string, query: string): Promise<string> {
  const parts: string[] = [];

  // 1. Long-term memory
  try {
    const results = await searchMemory(agent, query);
    if (results.length > 0) {
      parts.push(results.slice(0, 3).map(r => `[记忆: ${r.key}] ${r.content.slice(0, 150)}`).join('\n'));
    }
  } catch (e) { console.error('[lib:relay]', e); }

  // 2. Recent conversation
  try {
    const sessionPath = path.join(AGENTS_DIR, agent, 'chat', 'session.json');
    if (fs.existsSync(sessionPath)) {
      const session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      const recent = (session.messages || []).slice(-8);
      if (recent.length > 0) {
        parts.push(recent.map((m: any) => `[${m.role}] ${(m.content || '').slice(0, 100)}`).join('\n'));
      }
    }
  } catch (e) { console.error('[lib:relay]', e); }

  if (parts.length === 0) return '';
  return `\n\n--- RAG Context ---\n${parts.join('\n---\n')}\n--- End ---`;
}

// ── Settings ─────────────────────────────────────────────

function loadSettings(): { apiKey?: string; baseUrl?: string; model?: string } {
  try {
    const p = path.join(MIND_DIR, 'settings.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) { console.error('[lib:relay]', e); }
  return {};
}

// ── Agent API Key Management ─────────────────────────────
// Each agent has a unique relay key for authentication.
// Stored in .mind/agent-keys/<agent>.json

const KEYS_DIR = path.join(MIND_DIR, 'agent-keys');

function ensureKeysDir(): void {
  if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true });
}

/** Generate a relay API key for an agent */
export function generateRelayKey(agent: string): string {
  ensureKeysDir();
  const key = `ma_${agent}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const fp = path.join(KEYS_DIR, `${agent}.json`);
  fs.writeFileSync(fp, JSON.stringify({ agent, key, createdAt: Date.now() }), 'utf-8');
  return key;
}

/** Validate a relay API key */
export function validateRelayKey(key: string): string | null {
  try {
    const files = fs.readdirSync(KEYS_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const data = JSON.parse(fs.readFileSync(path.join(KEYS_DIR, f), 'utf-8'));
      if (data.key === key) return data.agent;
    }
  } catch (e) { console.error('[lib:relay]', e); }
  return null;
}

/** Get or create relay key for an agent */
export function getRelayKey(agent: string): string {
  ensureKeysDir();
  const fp = path.join(KEYS_DIR, `${agent}.json`);
  try {
    if (fs.existsSync(fp)) {
      const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      return data.key;
    }
  } catch (e) { console.error('[lib:relay]', e); }
  return generateRelayKey(agent);
}

// ── Forward to AI Provider ───────────────────────────────

async function forwardWithRetry(
  baseUrl: string, apiKey: string, model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number, retries = 2
): Promise<{ content: string; tokensIn: number; tokensOut: number }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await forwardToProvider(baseUrl, apiKey, model, messages, maxTokens);
    } catch (err: any) {
      if (attempt === retries) throw err;
      // Exponential backoff
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw new Error('Max retries exceeded');
}

async function forwardToProvider(
  baseUrl: string, apiKey: string, model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number
): Promise<{ content: string; tokensIn: number; tokensOut: number }> {
  const isAnthropic = baseUrl.includes('anthropic') || baseUrl.includes('claude') || baseUrl.includes('mimo');

  if (isAnthropic) {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Anthropic API error');
    return {
      content: data.content?.[0]?.text || '',
      tokensIn: data.usage?.input_tokens || 0,
      tokensOut: data.usage?.output_tokens || 0,
    };
  }

  // OpenAI-compatible
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'API error');
  return {
    content: data.choices?.[0]?.message?.content || '',
    tokensIn: data.usage?.prompt_tokens || 0,
    tokensOut: data.usage?.completion_tokens || 0,
  };
}

// ── Main Relay Function ──────────────────────────────────

export async function relay(req: RelayRequest): Promise<RelayResponse> {
  const { agent, messages, model: reqModel, maxTokens = 4096 } = req;
  const startTime = Date.now();

  // 1. Rate limit check
  if (!checkRateLimit(agent)) {
    throw new Error(`Rate limit exceeded for ${agent} (${RATE_LIMIT} req/min)`);
  }

  // 2. Load settings
  const settings = loadSettings();
  const baseUrl = settings.baseUrl || 'https://api.anthropic.com';
  const apiKey = settings.apiKey;
  const model = reqModel || settings.model || 'claude-sonnet-4-20250514';

  if (!apiKey) throw new Error('No API key configured');

  // 3. Check token balance
  const account = getAgentAccount(agent);
  if (account.balance <= 0 && account.earned === 0) {
    account.balance = 10000;
    account.earned = 10000;
    account.transactions.push({ type: 'bonus', amount: 10000, reason: 'Welcome bonus', timestamp: Date.now() });
    saveAgentAccount(account);
  }

  // 4. RAG — inject context
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role === 'user') {
    const ragContext = await ragSearch(agent, lastMsg.content);
    if (ragContext) lastMsg.content += ragContext;
  }

  // 5. Forward with retry
  const { content, tokensIn, tokensOut } = await forwardWithRetry(baseUrl, apiKey, model, messages, maxTokens);

  // 6. Calculate cost
  const pricing = getModelPricing(model);
  const cost = (tokensIn * pricing.input + tokensOut * pricing.output) / 1_000_000;
  const latencyMs = Date.now() - startTime;

  // 7. Deduct balance
  account.balance -= cost;
  account.spent += cost;
  account.transactions.push({ type: 'api_call', amount: -cost, model, tokensIn, tokensOut, timestamp: Date.now() });
  saveAgentAccount(account);

  // 8. Log request
  writeLog({ timestamp: Date.now(), agent, model, tokensIn, tokensOut, cost, latencyMs, status: 'success' });

  // 9. Record for analytics
  try {
    await fetch(`${getApiBase()}/api/system/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, tokensIn, tokensOut, cost, model }),
    });
  } catch (e) { console.error('[lib:relay]', e); }

  return { content, usage: { tokensIn, tokensOut, cost }, balance: account.balance, model, latencyMs };
}

// ── Export log reader for dashboard ───────────────────────

export { readLogs };
