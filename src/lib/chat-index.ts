/**
 * Chat Message Index — in-memory with JSON persistence.
 *
 * Scans all Groups/<name>/chat/*.md → builds structured index.
 * Incremental on subsequent loads (only re-scans files with newer mtime).
 *
 * Index structures:
 *   messages[]      — all messages, newest first
 *   byGroup[g][d]   — group→date→message IDs
 *   byAgent[from]   — agent→message IDs (who said it)
 *   byMention[name] — mentioned agent→message IDs
 *   inverted[word]  — word→message ID set (lowercase, min 2 chars)
 *
 * Query API:
 *   search(q)          → keyword search
 *   getByGroup(g, n)  → recent N from group
 *   getByAgent(a, n)  → recent N by agent
 *   getMentionsOf(a)  → messages mentioning a
 *   getUnread(g, a)   → messages since last check
 *
 * Serialized to: .mind/chat-index.json
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { GROUPS_DIR, MIND_DIR } from './data-dir';

// ── Types ────────────────────────────────────────────────

export interface IndexedMessage {
  id: string;       // hash of group+date+from+body_prefix
  group: string;
  date: string;     // e.g. "2026-06-02"
  from: string;
  body: string;     // truncated to 500 chars
  mentions: string[];  // extracted @names
  file: string;     // relative path from GROUPS_DIR
  offset: number;   // byte offset in file
  timestamp: number;
}

export interface ChatIndex {
  version: 1;
  builtAt: number;
  messages: IndexedMessage[];
  /** file path → last mtime seen */
  fileMtimes: Record<string, number>;
  /** group → date → message IDs */
  byGroup: Record<string, Record<string, string[]>>;
  /** agent name (lowercase) → message IDs */
  byAgent: Record<string, string[]>;
  /** mentioned name (lowercase) → message IDs */
  byMention: Record<string, string[]>;
  /** word (lowercase) → Set of message IDs */
  inverted: Record<string, string[]>;
}

// ── State ───────────────────────────────────────────────

const INDEX_FILE = path.join(MIND_DIR, 'chat-index.json');
const BODY_MAX = 500;
const STOP_WORDS = new Set([
  '的', '是', '在', '了', '和', '就', '都', '而', '及', '与',
  '着', '或', '一个', '没有', '我们', '你们', '他们', '这个', '那个',
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'it', 'its', 'and', 'or', 'not', 'no', 'but', 'if', 'so',
  'that', 'this', 'these', 'those', 'has', 'have', 'do', 'does',
]);

let index: ChatIndex | null = null;
let dirty = false;

// ── Load / Save ──────────────────────────────────────────

export function loadIndex(): ChatIndex {
  if (index) return index;

  try {
    if (fs.existsSync(INDEX_FILE)) {
      const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
      if (raw.version === 1) {
        index = raw as ChatIndex;
        console.log(`[index] loaded ${index.messages.length} messages`);
        return index;
      }
    }
  } catch {}

  // Fresh
  index = {
    version: 1,
    builtAt: Date.now(),
    messages: [],
    fileMtimes: {},
    byGroup: {},
    byAgent: {},
    byMention: {},
    inverted: {},
  };
  console.log('[index] fresh');
  return index;
}

export function saveIndex(): void {
  if (!index || !dirty) return;
  index.builtAt = Date.now();

  const dir = path.dirname(INDEX_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Compact: deduplicate message IDs in inverted index arrays
  const compact = JSON.parse(JSON.stringify(index));
  const { atomicWrite } = require('./atomic');
  atomicWrite(INDEX_FILE, JSON.stringify(compact));
  console.log(`[index] saved to ${INDEX_FILE} (${index.messages.length} msgs)`);
  dirty = false;
}

// ── Parsing ──────────────────────────────────────────────

function tokenize(text: string): string[] {
  // Split on non-word characters, keep CJK characters as single tokens
  const tokens: string[] = [];
  // Chinese: each char is a token; English: split by word boundary
  const words = text.toLowerCase().split(/[^a-z0-9一-鿿]+/).filter(Boolean);
  for (const w of words) {
    if (/^[一-鿿]+$/.test(w)) {
      // CJK: break into individual chars
      for (const ch of w) {
        if (ch.length >= 1 && !STOP_WORDS.has(ch)) tokens.push(ch);
      }
    } else if (w.length >= 2 && !STOP_WORDS.has(w)) {
      tokens.push(w);
    }
  }
  return tokens;
}

function parseChatFile(filePath: string): { from: string; date: string; body: string; offset: number }[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const msgs: { from: string; date: string; body: string; offset: number }[] = [];
    const blocks = raw.split(/\n(?=---\nfrom:)/);
    for (const block of blocks) {
      const m = block.match(/^---\nfrom:\s*(.+?)\ndate:\s*(.+?)\n---\n\n([\s\S]*)/);
      if (m) {
        msgs.push({
          from: m[1].trim(),
          date: m[2].trim(),
          body: m[3].trim(),
          offset: raw.indexOf(block),
        });
      }
    }
    return msgs;
  } catch { return []; }
}

function extractMentions(body: string): string[] {
  const matches = body.match(/@(\w+)/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.slice(1).toLowerCase()))];
}

// ── Build / Rebuild ──────────────────────────────────────

/**
 * Scan all chat files and index new/updated content.
 * Returns number of new messages indexed.
 */
export function refreshIndex(): number {
  const idx = loadIndex();
  let newCount = 0;

  if (!fs.existsSync(GROUPS_DIR)) return 0;

  for (const g of fs.readdirSync(GROUPS_DIR, { withFileTypes: true })) {
    if (!g.isDirectory() || g.name.startsWith('.')) continue;

    const chatDir = path.join(GROUPS_DIR, g.name, 'chat');
    if (!fs.existsSync(chatDir)) continue;

    for (const cf of fs.readdirSync(chatDir)) {
      if (!cf.endsWith('.md')) continue;

      const fp = path.join(chatDir, cf);
      const relPath = `${g.name}/chat/${cf}`;

      let mtime: number;
      try { mtime = fs.statSync(fp).mtimeMs; } catch { continue; }

      // Skip if file hasn't changed
      if (idx.fileMtimes[relPath] && idx.fileMtimes[relPath] >= mtime) continue;

      // Track old offsets for this file to skip already-indexed messages
      const oldOffsets = new Set(
        idx.messages
          .filter(m => m.file === relPath)
          .map(m => m.offset)
      );

      const parsed = parseChatFile(fp);
      for (const msg of parsed) {
        // Skip if already indexed (same offset)
        if (oldOffsets.has(msg.offset)) continue;

        const body = msg.body.slice(0, BODY_MAX);
        const mentions = extractMentions(body);
        const ts = new Date(msg.date).getTime() || Date.now();
        const dateStr = msg.date.split('T')[0];

        const entry: IndexedMessage = {
          id: crypto.createHash('md5').update(g.name + dateStr + msg.from + body.slice(0, 80)).digest('hex').slice(0, 12),
          group: g.name,
          date: dateStr,
          from: msg.from,
          body,
          mentions,
          file: relPath,
          offset: msg.offset,
          timestamp: ts,
        };

        // ── Insert ──
        idx.messages.push(entry);
        newCount++;

        // byGroup
        if (!idx.byGroup[g.name]) idx.byGroup[g.name] = {};
        if (!idx.byGroup[g.name][dateStr]) idx.byGroup[g.name][dateStr] = [];
        idx.byGroup[g.name][dateStr].push(entry.id);

        // byAgent
        const fromKey = msg.from.toLowerCase();
        if (!idx.byAgent[fromKey]) idx.byAgent[fromKey] = [];
        idx.byAgent[fromKey].push(entry.id);

        // byMention
        for (const m of mentions) {
          const mk = m.toLowerCase();
          if (!idx.byMention[mk]) idx.byMention[mk] = [];
          idx.byMention[mk].push(entry.id);
        }

        // inverted index
        for (const token of tokenize(body)) {
          if (!idx.inverted[token]) idx.inverted[token] = [];
          if (!idx.inverted[token].includes(entry.id)) {
            idx.inverted[token].push(entry.id);
          }
        }
      }

      idx.fileMtimes[relPath] = mtime;
    }
  }

  // Sort messages newest first
  idx.messages.sort((a, b) => b.timestamp - a.timestamp);

  if (newCount > 0) {
    dirty = true;
    console.log(`[index] +${newCount} new messages (total: ${idx.messages.length})`);
    saveIndex(); // persist immediately — no need to wait for scheduler to stop
  }
  return newCount;
}

// ── Query API ─────────────────────────────────────────────

/** Full-text keyword search. Returns matching messages, newest first. */
export function search(query: string, limit = 50): IndexedMessage[] {
  const idx = loadIndex();
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  // Intersection of matching IDs
  let idSet: Set<string> | null = null;
  for (const t of tokens) {
    const matches: Set<string> = new Set(idx.inverted[t] || []);
    if (idSet === null) { idSet = matches; }
    else {
      // Intersection: keep only IDs present in both sets
      const next = new Set<string>();
      for (const id of idSet) { if (matches.has(id)) next.add(id); }
      idSet = next;
    }
  }
  if (!idSet || idSet.size === 0) return [];
  return idx.messages.filter(m => idSet.has(m.id)).slice(0, limit);
}

/** Get recent N messages from a group. */
export function getByGroup(group: string, limit = 30): IndexedMessage[] {
  const idx = loadIndex();
  return idx.messages.filter(m => m.group === group).slice(0, limit);
}

/** Get recent N messages by an agent. */
export function getByAgent(agent: string, limit = 30): IndexedMessage[] {
  const idx = loadIndex();
  const key = agent.toLowerCase();
  const byAgent = idx.byAgent[key];
  if (!byAgent) return [];
  const idSet = new Set(byAgent);
  return idx.messages.filter(m => idSet.has(m.id)).slice(0, limit);
}

/** Get messages that mention a specific agent. */
export function getMentionsOf(agent: string, limit = 30): IndexedMessage[] {
  const idx = loadIndex();
  const key = agent.toLowerCase();
  const ids = idx.byMention[key];
  if (!ids) return [];
  const idSet = new Set(ids);
  return idx.messages.filter(m => idSet.has(m.id)).slice(0, limit);
}

/** Get messages between two dates (inclusive). */
export function getByDateRange(from: string, to: string, group?: string): IndexedMessage[] {
  const idx = loadIndex();
  return idx.messages.filter(m => {
    if (group && m.group !== group) return false;
    return m.date >= from && m.date <= to;
  });
}

/** Get total indexed message count. */
export function getStats(): { total: number; groups: string[]; agents: string[]; lastBuilt: number } {
  const idx = loadIndex();
  return {
    total: idx.messages.length,
    groups: Object.keys(idx.byGroup),
    agents: Object.keys(idx.byAgent),
    lastBuilt: idx.builtAt,
  };
}
