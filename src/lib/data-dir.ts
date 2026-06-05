/**
 * Unified data directory resolver.
 *
 * In dev (next dev):     process.cwd() = project root
 * In Electron packaged:  MIND_DATA_DIR = %APPDATA%/MindAgency/data/
 *
 * All mutable data (Agents/, Groups/, .audit/, .mind/) lives in DATA_DIR.
 * Read-only app code (mcp/, src/) lives in APP_DIR.
 *
 * In dev mode, DATA_DIR === APP_DIR (both = project root).
 * In packaged mode, they separate:
 *   DATA_DIR  = %APPDATA%/mind-agency/data/  (writable, seeded on first run)
 *   APP_DIR   = EXE/resources/app/            (read-only)
 */

import path from 'path';

const DATA_DIR = process.env.MIND_DATA_DIR || process.cwd();
const APP_DIR  = process.env.MIND_APP_DIR  || DATA_DIR;

export const AGENTS_DIR = path.join(DATA_DIR, 'Agents');
export const GROUPS_DIR = path.join(DATA_DIR, 'Groups');
export const AUDIT_DIR  = path.join(DATA_DIR, '.audit');
export const MIND_DIR   = path.join(DATA_DIR, '.mind');
export const MCP_DIR    = path.join(APP_DIR,  'mcp');   // app code, read-only
export const SRC_DIR    = path.join(APP_DIR,  'src');   // app code, read-only

export default DATA_DIR;
