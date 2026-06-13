/**
 * Centralized configuration constants.
 *
 * Polling intervals, timeouts, and other magic numbers live here.
 * Never hardcode these values in components — import from here.
 */

// ── Polling intervals (ms) ──
export const POLL = {
  /** Chat message polling */
  CHAT: 5_000,
  /** Email polling */
  EMAIL: 10_000,
  /** Dashboard activity polling */
  DASHBOARD: 15_000,
  /** Workflow status polling */
  WORKFLOW: 3_000,
  /** Sidebar refresh */
  SIDEBAR: 10_000,
  /** Heartbeat check */
  HEARTBEAT: 5_000,
} as const;

// ── WebSocket ──
export const WS = {
  /** Reconnect delay after disconnect */
  RECONNECT_DELAY: 5_000,
  /** WS server port */
  PORT: 3001,
} as const;

// ── Timeouts (ms) ──
export const TIMEOUT = {
  /** AI provider request timeout */
  AI_REQUEST: 120_000,
  /** MCP tool call timeout */
  MCP_TOOL: 30_000,
  /** Workflow step callback timeout */
  WORKFLOW_STEP: 300_000,
} as const;

// ── Limits ──
export const LIMITS = {
  /** Max chat history messages per session */
  CHAT_HISTORY: 100,
  /** Max chat history during version merge */
  CHAT_MERGE: 50,
  /** Max notification items */
  NOTIFICATIONS: 10,
  /** Max dashboard events */
  DASHBOARD_EVENTS: 8,
} as const;
