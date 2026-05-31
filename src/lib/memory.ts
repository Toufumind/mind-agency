/**
 * Agent Memory — v0.3 CrewAI three-layer adaptation
 *
 * Short-term:  chat session.json (existing, managed by chat.ts)
 * Long-term:   .mind/agents/<agent>/memory/<key>.md with frontmatter
 * Entity:      Groups/<group>/TASK_SPEC.md + config.json
 *
 * Provides: write, read, search, list, delete — persistent across restarts.
 * Searches are case-insensitive substring matches across key + content.
 */

import fs from 'fs';
import path from 'path';

const MIND_DIR = path.join(process.cwd(), '.mind');

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
  return entry;
}

/** Read a specific memory */
export function readMemory(agentName: string, key: string): MemoryEntry | null {
  const mp = memPath(agentName, key);
  if (!fs.existsSync(mp)) return null;
  return parseMemoryFile(mp);
}

/** Search memories by substring (case-insensitive) */
export function searchMemory(agentName: string, query: string): MemoryEntry[] {
  const dir = agentMemDir(agentName);
  if (!fs.existsSync(dir)) return [];
  const q = query.toLowerCase();
  const results: MemoryEntry[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    try {
      const entry = parseMemoryFile(path.join(dir, f));
      if (!entry) continue;
      if (entry.key.toLowerCase().includes(q) || entry.content.toLowerCase().includes(q)) {
        results.push(entry);
      }
    } catch {}
  }
  return results.sort((a, b) => b.updated - a.updated).slice(0, 10);
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
  return true;
}

/** Get memory context for injection into chat prompt (top 5 most recent) */
export function getMemoryContext(agentName: string): string {
  const mems = listMemory(agentName);
  if (mems.length === 0) return '';
  const recent = mems.slice(0, 5);
  return '\n[长期记忆]\n' + recent.map(m =>
    `- ${m.key}: ${m.content.slice(0, 200)}`
  ).join('\n');
}

/** Get entity memory context (group tasks + config) */
export function getEntityContext(agentName: string): string {
  const parts: string[] = [];
  const gd = path.join(process.cwd(), 'Groups');
  if (!fs.existsSync(gd)) return '';

  for (const g of fs.readdirSync(gd, { withFileTypes: true })) {
    if (!g.isDirectory() || g.name.startsWith('.')) continue;
    const agDir = path.join(gd, g.name, 'Agents');
    if (!fs.existsSync(agDir)) continue;
    const isMember = fs.readdirSync(agDir, { withFileTypes: true })
      .some(e => e.isDirectory() && e.name.toLowerCase() === agentName.toLowerCase());
    if (!isMember) continue;

    // Read TASK_SPEC if exists
    const specPath = path.join(gd, g.name, 'TASK_SPEC.md');
    if (fs.existsSync(specPath)) {
      try {
        const spec = fs.readFileSync(specPath, 'utf-8').slice(0, 300);
        parts.push(`[${g.name}] ${spec}`);
      } catch {}
    }

    // Read workflow.yaml summary if exists
    const wfPath = path.join(gd, g.name, 'workflow.yaml');
    if (fs.existsSync(wfPath)) {
      try {
        const raw = fs.readFileSync(wfPath, 'utf-8');
        // Extract just name + description from YAML (simple approach)
        const nameMatch = raw.match(/^name:\s*(.+)/m);
        const descMatch = raw.match(/^description:\s*(.+)/m);
        if (nameMatch) parts.push(`[${g.name} workflow] ${nameMatch[1]}${descMatch ? ': ' + descMatch[1] : ''}`);
      } catch {}
    }
  }

  return parts.length > 0 ? '\n[实体记忆·团队上下文]\n' + parts.join('\n') : '';
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
