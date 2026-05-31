/**
 * Utility to broadcast messages and emit events to the WebSocket server.
 *
 * This makes HTTP POSTs to the WS server's endpoints on :3001.
 * Works from both Next.js API routes (same machine) and the MCP group-server.
 */

const WS_PORT = process.env.WS_PORT || '3001';
const WS_BASE_URL = process.env.WS_BASE_URL || `http://localhost:${WS_PORT}`;
const WS_BROADCAST_URL = process.env.WS_BROADCAST_URL || `${WS_BASE_URL}/broadcast`;
const WS_EVENTS_URL = process.env.WS_EVENTS_URL || `${WS_BASE_URL}/events`;

// ── Types ────────────────────────────────────────────────────────────────

export interface WSBroadcastMessage {
  type: 'group_message' | 'new_email' | 'connected';
  group?: string;
  from?: string;
  to?: string;
  subject?: string;
  message?: string;
  timestamp?: string;
}

export interface EventMessage {
  event: string;
  payload: Record<string, unknown>;
  timestamp: number;
  source: string;
  id: string;
}

// ── Shared HTTP helpers ──────────────────────────────────────────────────

import http from 'http';
import https from 'https';

function httpPost(urlStr: string, body: Record<string, unknown>): void {
  const url = new URL(urlStr);
  const mod = url.protocol === 'https:' ? https : http;

  const data = JSON.stringify(body);
  const req = http.request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    },
    (res: any) => {
      res.resume(); // Consume response to avoid memory leaks
    }
  );

  req.on('error', (err: Error) => {
    // WS server may not be running — that's fine
    console.error(`[ws-broadcast] POST ${url.pathname} failed: ${err.message}`);
  });

  req.write(data);
  req.end();
}

// ── Broadcast (legacy, for group chat messages) ─────────────────────────

/**
 * Send a group chat message to the WebSocket broadcast endpoint.
 * Fire-and-forget — never throws, logs errors to stderr.
 *
 * For legacy clients and subscribers with scope "messages" or "all".
 */
export function broadcastToClients(msg: WSBroadcastMessage): void {
  const body = {
    ...msg,
    timestamp: msg.timestamp || new Date().toISOString(),
  };
  httpPost(WS_BROADCAST_URL, body);
}

// ── Event Bus emit ───────────────────────────────────────────────────────

/**
 * Emit an Event Bus event to the WS server.
 * The server routes it to matching subscribers (scope "events" or "all").
 *
 * Fire-and-forget — never throws.
 */
export function emitEvent(event: EventMessage): void {
  httpPost(WS_EVENTS_URL, event as unknown as Record<string, unknown>);
}
