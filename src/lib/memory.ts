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
import { MIND_DIR, AGENTS_DIR, GROUPS_DIR } from './data-dir';

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
  fs.writeFileSync(mp, body, 'utf-8');
  // Invalidate cache so next getMemoryContext() reads fresh data
  invalidateMemoryCache(agentName);
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

/** Fallback: TF-IDF scoring */
function scoreMatch(query: string, key: string, content: string): number {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 0;
  const keyTokens = new Set(tokenize(key));
  const contentTokens = new Set(tokenize(content));
  let score = 0;
  for (const qt of [...new Set(qTokens)]) {
    const tf = qTokens.filter(t => t === qt).length / qTokens.length;
    score += tf * ((keyTokens.has(qt) ? 2 : 0) + (contentTokens.has(qt) ? 1 : 0));
  }
  if ((key + ' ' + content).toLowerCase().includes(query.toLowerCase())) score += 5;
  return score;
}

/** v0.4: Semantic search with local embedding model */
export async function searchMemory(agentName: string, query: string): Promise<MemoryEntry[]> {
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
    const { embed, cosineSimilarity } = await import('./embedding');
    const queryVec = await embed(query);
    const scored = entries.map(entry => {
      const text = `${entry.key} ${entry.content}`;
      // For short text, concatenate key + content for embedding
      const entryVec$ = embed(text);
      return { entry, text };
    });

    // Embed all entries (batch)
    const texts = entries.map(e => `${e.key} ${e.content}`);
    const entryVecs = await Promise.all(texts.map(t => embed(t)));

    const results = entries.map((entry, i) => ({
      entry,
      score: cosineSimilarity(queryVec, entryVecs[i]),
    }));

    // Also add TF-IDF substring bonus for exact matches
    const q = query.toLowerCase();
    for (const r of results) {
      if (r.entry.key.toLowerCase().includes(q) || r.entry.content.toLowerCase().includes(q)) {
        r.score += 0.5;
      }
    }

    return results
      .sort((a, b) => b.score - a.score || b.entry.updated - a.entry.updated)
      .slice(0, 10)
      .map(r => r.entry);
  } catch {
    // Fallback to TF-IDF if embedding model not available
    const q = query.toLowerCase();
    const results = entries
      .map(entry => ({ entry, score: scoreMatch(query, entry.key, entry.content) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.updated - a.entry.updated)
      .slice(0, 10);
    return results.map(r => r.entry);
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
  // Invalidate cache so next getMemoryContext() reads fresh data
  invalidateMemoryCache(agentName);
  return true;
}

// ── Memory context cache ──────────────────────────────────
const memoryContextCache = new Map<string, { data: string; ts: number }>();
const MEMORY_CACHE_TTL = 60_000; // 1 min

/** Invalidate memory cache for an agent (or all agents) */
export function invalidateMemoryCache(agentName?: string): void {
  if (agentName) memoryContextCache.delete(agentName);
  else memoryContextCache.clear();
}

/** Get memory context for injection into chat prompt (top 5 most recent) — cached */
export function getMemoryContext(agentName: string): string {
  const cached = memoryContextCache.get(agentName);
  const now = Date.now();
  if (cached && (now - cached.ts) < MEMORY_CACHE_TTL) return cached.data;

  const mems = listMemory(agentName);
  const result = mems.length === 0 ? '' :
    '\n[长期记忆]\n' + mems.slice(0, 5).map(m =>
      `- ${m.key}: ${m.content.slice(0, 200)}`
    ).join('\n');

  memoryContextCache.set(agentName, { data: result, ts: now });
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
