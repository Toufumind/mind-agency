#!/usr/bin/env node
/**
 * Build MCP Server — bundle group-server.ts → standalone .mjs
 *
 * Uses esbuild to produce a single-file ESM bundle that runs with `node`
 * directly (no tsx/tsc needed at runtime).
 *
 * Usage: node scripts/build-mcp.mjs
 * Output: mcp/group-server.mjs
 */

import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INPUT = path.join(ROOT, 'mcp', 'group-server.ts');
const OUTPUT = path.join(ROOT, 'mcp', 'group-server.mjs');

// Check if source is newer than output (skip if up-to-date)
try {
  const srcStat = existsSync(INPUT) && (await import('fs')).statSync(INPUT);
  const outStat = existsSync(OUTPUT) && (await import('fs')).statSync(OUTPUT);
  if (srcStat && outStat && srcStat.mtimeMs < outStat.mtimeMs) {
    console.log('[build:mcp] ✓ up-to-date');
    process.exit(0);
  }
} catch {}

console.log('[build:mcp] bundling group-server.ts → group-server.mjs...');

try {
  execSync(
    `npx esbuild "${INPUT}" --bundle --platform=node --format=esm ` +
    `--outfile="${OUTPUT}" ` +
    `--external:fs --external:path --external:http --external:crypto ` +
    `--external:readline --external:child_process --external:os`,
    { cwd: ROOT, stdio: 'pipe', timeout: 30_000 }
  );
  console.log('[build:mcp] ✓ done');
} catch (e) {
  console.error('[build:mcp] ✗ failed:', e.message);
  process.exit(1);
}
