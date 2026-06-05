/**
 * Atomic file writer — temp + rename to avoid partial writes.
 * Replaces appendFileSync for all structured data.
 */

import fs from 'fs';
import path from 'path';

/** Write atomically: write temp → rename (same fs = atomic on all major OS) */
export function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
}

/** Write a single chat message as its own file — no append, no concurrency issues.
 *  File: Groups/<name>/chat/<ts>_<from>.md
 */
export function writeChatMessage(groupDir: string, from: string, message: string): string {
  const chatDir = path.join(groupDir, 'chat');
  if (!fs.existsSync(chatDir)) fs.mkdirSync(chatDir, { recursive: true });
  const ts = Date.now();
  const filename = `${ts}_${sanitize(from)}.md`;
  const filePath = path.join(chatDir, filename);
  const content = `---\nfrom: ${from}\ndate: ${new Date().toISOString()}\n---\n\n${message}\n`;
  atomicWrite(filePath, content);
  return filename;
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
}
