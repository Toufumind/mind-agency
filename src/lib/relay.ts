/**
 * relay.ts — AI API relay with RAG + token billing
 *
 * Flow: Agent → Relay → RAG (search memory) → Inject context → AI Provider
 *       Relay tracks token usage and deducts from agent balance.
 */

import { searchMemory } from './memory';
import { getAgentAccount, saveAgentAccount, AgentAccount } from './token-economy';
import { readFileSync } from 'fs';
import { MIND_DIR } from './data-dir';

// ── Types ────────────────────────────────────────────────

export interface RelayRequest {
  agent: string;
  messages: Array<{ role: string; content: string }>;
  model?: string;
  maxTokens?: number;
}

export interface RelayResponse {
  content: string;
  usage: { tokensIn: number; tokensOut: number; cost: number };
  balance: number;
  ragContext?: string;
}

// ── Pricing (CNY per 1M tokens) ──────────────────────────

const PRICING: Record<string, { input: number; output: number }> = {
  'deepseek-v4-pro': { input: 3.0, output: 6.0 },
  'deepseek-v4-flash': { input: 1.0, output: 2.0 },
  'claude-sonnet-4': { input: 21.6, output: 108 },
  'claude-haiku': { input: 3.6, output: 18 },
  'gpt-4o': { input: 2.5, output: 10 },
  'default': { input: 3.0, output: 6.0 },
};

function getModelPricing(model: string): { input: number; output: number } {
  for (const [key, price] of Object.entries(PRICING)) {
    if (model.toLowerCase().includes(key)) return price;
  }
  return PRICING.default;
}

// ── RAG: Search relevant memories ────────────────────────

/** Load settings from .mind/settings.json */
function loadSettingsSync(): { apiKey?: string; baseUrl?: string; model?: string } {
  try {
    const settingsPath = require('path').join(MIND_DIR, 'settings.json');
    if (require('fs').existsSync(settingsPath)) {
      return JSON.parse(readFileSync(settingsPath, 'utf-8'));
    }
  } catch {}
  return {};
}

async function ragSearch(agent: string, query: string): Promise<string> {
  const parts: string[] = [];

  // 1. Search long-term memory (.mind/agents/<name>/memory/*.md)
  try {
    const memResults = await searchMemory(agent, query);
    if (memResults.length > 0) {
      const memContext = memResults
        .slice(0, 3)
        .map(r => `[记忆: ${r.key}] ${r.content.slice(0, 150)}`)
        .join('\n');
      parts.push(memContext);
    }
  } catch {}

  // 2. Search recent conversation history (session.json)
  try {
    const sessionPath = require('path').join(AGENTS_DIR, agent, 'chat', 'session.json');
    if (require('fs').existsSync(sessionPath)) {
      const session = JSON.parse(readFileSync(sessionPath, 'utf-8'));
      const recentMsgs = (session.messages || []).slice(-10);
      if (recentMsgs.length > 0) {
        const convContext = recentMsgs
          .map(m => `[${m.role}] ${(m.content || '').slice(0, 100)}`)
          .join('\n');
        parts.push(`[最近对话]\n${convContext}`);
      }
    }
  } catch {}

  if (parts.length === 0) return '';
  return `\n\n--- RAG Context ---\n${parts.join('\n---\n')}\n--- End RAG ---`;
}

// ── Forward to AI provider ───────────────────────────────

async function forwardToProvider(
  baseUrl: string,
  apiKey: string,
  model: string,
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
    if (data.error) throw new Error(data.error.message || 'API error');
    const content = data.content?.[0]?.text || '';
    return { content, tokensIn: data.usage?.input_tokens || 0, tokensOut: data.usage?.output_tokens || 0 };
  }

  // OpenAI-compatible
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'API error');
  const content = data.choices?.[0]?.message?.content || '';
  return { content, tokensIn: data.usage?.prompt_tokens || 0, tokensOut: data.usage?.completion_tokens || 0 };
}

// ── Main relay function ──────────────────────────────────

export async function relay(req: RelayRequest): Promise<RelayResponse> {
  const { agent, messages, model: reqModel, maxTokens = 4096 } = req;

  // 1. Load settings
  const settings = loadSettingsSync();
  const baseUrl = settings.baseUrl || 'https://api.anthropic.com';
  const apiKey = settings.apiKey;
  const model = reqModel || settings.model || 'claude-sonnet-4-20250514';

  if (!apiKey) throw new Error('No API key configured');

  // 2. Check token balance
  const account = getAgentAccount(agent);
  if (account.balance <= 0 && account.earned === 0) {
    // Welcome bonus
    account.balance = 10000;
    account.earned = 10000;
    account.transactions.push({ type: 'bonus', amount: 10000, reason: 'Welcome bonus', timestamp: Date.now() });
    saveAgentAccount(account);
  }

  // 3. RAG — search relevant memories and inject into last user message
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role === 'user') {
    const ragContext = await ragSearch(agent, lastMsg.content);
    if (ragContext) {
      lastMsg.content += ragContext;
    }
  }

  // 4. Forward to AI provider
  const { content, tokensIn, tokensOut } = await forwardToProvider(baseUrl, apiKey, model, messages, maxTokens);

  // 5. Calculate cost
  const pricing = getModelPricing(model);
  const cost = (tokensIn * pricing.input + tokensOut * pricing.output) / 1_000_000;

  // 6. Deduct from balance
  account.balance -= cost;
  account.spent += cost;
  account.transactions.push({
    type: 'api_call',
    amount: -cost,
    model,
    tokensIn,
    tokensOut,
    timestamp: Date.now(),
  });
  saveAgentAccount(account);

  // 7. Record for analytics
  try {
    await fetch('http://127.0.0.1:3000/api/system/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, tokensIn, tokensOut, cost, model }),
    });
  } catch {}

  return {
    content,
    usage: { tokensIn, tokensOut, cost },
    balance: account.balance,
  };
}
