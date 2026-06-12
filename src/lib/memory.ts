// @ts-nocheck
/**
 * Agent Memory — v0.4 CrewAI three-layer adaptation
 *
 * Short-term:  chat session.json (existing, managed by chat.ts)
 * Long-term:   .mind/agents/<agent>/memory/<key>.md with frontmatter
 * Entity:      Groups/<group>/TASK_SPEC.md + config.json
 *
 * v0.4: Semantic search via local all-MiniLM-L6-v2 embedding model.
 * Falls back to TF-IDF if model not available.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { MIND_DIR, AGENTS_DIR, GROUPS_DIR } from './data-dir';
import { agentCache } from './cache';
import { atomicWrite } from './atomic';

function agentMemDir(agentName: string): string {
  return path.join(MIND_DIR, 'agents', agentName, 'memory');
}

function memPath(agentName: string, key: string): string {
  return path.join(agentMemDir(agentName), `${sanitize(key)}.md`);
}

function sanitize(key: string): string {
  return key.replace(/[^a-zA-Z0-9一-鿿_-]/g, '_').slice(0, 64);
}

export interface MemoryEntry {
  key: string;
  content: string;
  created: number;
  updated: number;
}

/** Write a persistent memory for an agent */
export function writeMemory(agentName: string, key: string, content: string): MemoryEntry {
  const dir = agentMemDir(agentName);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const mp = memPath(agentName, key);
  const now = Date.now();
  let created = now;
  if (fs.existsSync(mp)) {
    try {
      const existing = parseMemoryFile(mp);
      if (existing) created = existing.created;
    } catch {}
  }
  const entry: MemoryEntry = { key, content, created, updated: now };
  const body = `---
key: ${key}
created: ${new Date(created).toISOString()}
updated: ${new Date(now).toISOString()}
---

${content}
`;
  atomicWrite(mp, body);
  // Invalidate all caches
  invalidateMemoryCache(agentName);
  invalidateSearchCache(agentName);
  // Invalidate agent's baseOptions cache (system prompt contains memory)
  agentCache.invalidate('config', agentName + ':baseOptions');
  return entry;
}

/** Read a specific memory */
export function readMemory(agentName: string, key: string): MemoryEntry | null {
  const mp = memPath(agentName, key);
  if (!fs.existsSync(mp)) return null;
  return parseMemoryFile(mp);
}

/** v0.4: Tokenize text for fallback search (supports Chinese + English) */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  for (const m of lower.match(/[a-z0-9_]+/g) || []) tokens.push(m);
  for (const m of lower.match(/[一-鿿]/g) || []) tokens.push(m);
  const cn = lower.match(/[一-鿿]+/g) || [];
  for (const phrase of cn) {
    for (let i = 0; i < phrase.length - 1; i++) {
      tokens.push(phrase.slice(i, i + 2));
    }
  }
  return tokens;
}

/** Fallback: TF-IDF scoring (pre-tokenized for performance) */
function scoreMatchPreTokenized(queryTokens: string[], keyTokens: Set<string>, contentTokens: Set<string>, rawQuery: string, rawText: string): number {
  if (queryTokens.length === 0) return 0;
  let score = 0;
  for (const qt of [...new Set(queryTokens)]) {
    const tf = queryTokens.filter(t => t === qt).length / queryTokens.length;
    score += tf * ((keyTokens.has(qt) ? 2 : 0) + (contentTokens.has(qt) ? 1 : 0));
  }
  if (rawText.toLowerCase().includes(rawQuery.toLowerCase())) score += 5;
  return score;
}

/** Invalidate search cache for an agent */
export function invalidateSearchCache(agentName?: string): void {
  if (agentName) {
    agentCache.invalidateRegion('memory');
  } else {
    agentCache.invalidateRegion('memory');
  }
}

/** v0.4: Semantic search with local embedding model — cached */
export async function searchMemory(agentName: string, query: string): Promise<MemoryEntry[]> {
  // Use hash of query to reduce memory usage
  const queryHash = crypto.createHash('md5').update(query).digest('hex').slice(0, 8);
  const cacheKey = `${agentName}:${queryHash}`;
  const cached = agentCache.get<MemoryEntry[]>('memory', cacheKey);
  if (cached) return cached;

  const dir = agentMemDir(agentName);
  if (!fs.existsSync(dir)) return [];

  const entries: MemoryEntry[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    try {
      const entry = parseMemoryFile(path.join(dir, f));
      if (entry) entries.push(entry);
    } catch {}
  }
  if (entries.length === 0) return [];

  // Try embedding search, fall back to TF-IDF
  try {
    const { embed, cosineSimilarity, tfidfVector, sparseCosine } = await import('./embedding');
    const queryVec = await embed(query);

    // Build IDF from corpus
    const docFreq = new Map<string, number>();
    const entryTexts = entries.map(e => `${e.key} ${e.content}`);
    for (const text of entryTexts) {
      const tokens = [...new Set(text.toLowerCase().match(/[a-z0-9_]+|[一-鿿]+/g) || [])];
      for (const t of tokens) docFreq.set(t, (docFreq.get(t) || 0) + 1);
    }
    const N = entries.length;
    const idf = new Map<string, number>();
    for (const [t, df] of docFreq) idf.set(t, Math.log((N + 1) / (df + 1)) + 1);

    const queryTfIdf = tfidfVector(query, idf);
    const entryVecs = entryTexts.map(t => embed(t));
    const entryTfIdfs = entryTexts.map(t => tfidfVector(t, idf));

    // Dual-channel scoring: 60% SimHash (semantic) + 40% TF-IDF (keyword)
    const results = entries.map((entry, i) => ({
      entry,
      score: 0.6 * cosineSimilarity(queryVec, entryVecs[i]) + 0.4 * sparseCosine(queryTfIdf, entryTfIdfs[i]),
    }));

    const finalResults = results
      .sort((a, b) => b.score - a.score || b.entry.updated - a.entry.updated)
      .slice(0, 10)
      .map(r => r.entry);
    agentCache.set('memory', cacheKey, finalResults);
    return finalResults;
  } catch (err) {
    console.warn(`[memory] Embedding search failed, falling back to TF-IDF:`, err);
    // Fallback to TF-IDF if embedding model not available
    const queryTokens = tokenize(query);
    const results = entries
      .map(entry => ({ entry, score: scoreMatchPreTokenized(queryTokens, new Set(tokenize(entry.key)), new Set(tokenize(entry.content)), query, `${entry.key} ${entry.content}`) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.updated - a.entry.updated)
      .slice(0, 10);
    const finalResults = results.map(r => r.entry);
    agentCache.set('memory', cacheKey, finalResults);
    return finalResults;
  }
}

/** List all memories for an agent */
export function listMemory(agentName: string): MemoryEntry[] {
  const dir = agentMemDir(agentName);
  if (!fs.existsSync(dir)) return [];
  const results: MemoryEntry[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    try {
      const entry = parseMemoryFile(path.join(dir, f));
      if (entry) results.push(entry);
    } catch {}
  }
  return results.sort((a, b) => b.updated - a.updated);
}

/** Delete a memory */
export function deleteMemory(agentName: string, key: string): boolean {
  const mp = memPath(agentName, key);
  if (!fs.existsSync(mp)) return false;
  fs.unlinkSync(mp);
  // Invalidate all caches
  invalidateMemoryCache(agentName);
  invalidateSearchCache(agentName);
  // Invalidate agent's baseOptions cache (system prompt contains memory)
  agentCache.invalidate('config', agentName + ':baseOptions');
  return true;
}

/** Invalidate memory cache for an agent (or all agents) */
export function invalidateMemoryCache(agentName?: string): void {
  if (agentName) {
    agentCache.invalidate('memoryContext', agentName);
  } else {
    agentCache.invalidateRegion('memoryContext');
  }
}

/** Estimate token count (1 Chinese char ≈ 1.5 tokens, 1 English word ≈ 1 token) */
function estimateTokens(text: string): number {
  const cn = (text.match(/[一-鿿]/g) || []).length * 1.5;
  const en = (text.match(/[a-zA-Z0-9]+/g) || []).length;
  return Math.ceil(cn + en);
}

/** Get memory context for injection into chat prompt — with token budget */
export function getMemoryContext(agentName: string, maxTokens: number = 800): string {
  const cached = agentCache.get<string>('memoryContext', agentName);
  if (cached !== null) return cached;

  const mems = listMemory(agentName);
  if (mems.length === 0) {
    agentCache.set('memoryContext', agentName, '');
    return '';
  }

  // Build context with token budget — most recent first, stop when budget exceeded
  const lines: string[] = [];
  let usedTokens = 0;
  for (const m of mems) {
    const line = `- ${m.key}: ${m.content.slice(0, 200)}`;
    const tokens = estimateTokens(line);
    if (usedTokens + tokens > maxTokens) break;
    lines.push(line);
    usedTokens += tokens;
  }

  const result = lines.length === 0 ? '' :
    `\n[长期记忆] (共 ${lines.length}/${mems.length} 条，~${Math.round(usedTokens)} tokens)\n` + lines.join('\n');

  // v0.5: If memory context changed, invalidate baseOptions
  // Always invalidate baseOptions when memory context is rebuilt (ensures sync)
  const prev = cached;
  if (prev !== result) {
    agentCache.invalidate('config', agentName + ':baseOptions');
  }

  agentCache.set('memoryContext', agentName, result);
  return result;
}

function parseMemoryFile(filePath: string): MemoryEntry | null {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)/);
  if (!fmMatch) {
    // Fallback: treat entire file as content
    const stat = fs.statSync(filePath);
    const fileName = path.basename(filePath, '.md');
    return { key: fileName, content: raw.slice(0, 1000), created: stat.birthtimeMs, updated: stat.mtimeMs };
  }
  const frontmatter = fmMatch[1];
  const content = fmMatch[2].trim();
  const keyMatch = frontmatter.match(/key:\s*(.+)/);
  const createdMatch = frontmatter.match(/created:\s*(.+)/);
  const updatedMatch = frontmatter.match(/updated:\s*(.+)/);
  return {
    key: keyMatch?.[1]?.trim() || path.basename(filePath, '.md'),
    content: content.slice(0, 2000),
    created: createdMatch ? new Date(createdMatch[1]).getTime() : Date.now(),
    updated: updatedMatch ? new Date(updatedMatch[1]).getTime() : Date.now(),
  };
}
