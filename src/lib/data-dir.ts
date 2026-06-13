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

export const DATA_DIR = process.env.MIND_DATA_DIR || process.cwd();
const APP_DIR  = process.env.MIND_APP_DIR  || DATA_DIR;

export const AGENTS_DIR = path.join(DATA_DIR, 'Agents');
export const GROUPS_DIR = path.join(DATA_DIR, 'Groups');
export const AUDIT_DIR  = path.join(DATA_DIR, '.audit');
export const MIND_DIR   = path.join(DATA_DIR, '.mind');
export const MCP_DIR    = path.join(APP_DIR,  'mcp');   // app code, read-only
export const SRC_DIR    = path.join(APP_DIR,  'src');   // app code, read-only

// ── Centralized URL config ──
// Never hardcode 127.0.0.1:3000 or 127.0.0.1:3001 in source files.
const API_PORT = process.env.PORT || '3000';
const WS_PORT  = process.env.WS_PORT || '3001';
const API_HOST = process.env.HOSTNAME || '127.0.0.1';

// Server-side helpers (use in lib/, api routes, server code)
export const getApiBase = () => `http://${API_HOST}:${API_PORT}`;
export const getWsBase  = () => `http://${API_HOST}:${WS_PORT}`;

// Client-side helpers (use in React components)
// Next.js API routes are on the same origin, so use relative paths.
// The WS server (port 3001) needs an absolute URL — derive from window.
export const getClientApiBase = () => '';
export const getClientWsBase = () => {
  if (typeof window === 'undefined') return getWsBase();
  // In Electron, WS server is on same host, port 3001
  return `http://${window.location.hostname}:3001`;
};

export default DATA_DIR;
