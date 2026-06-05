/**
 * Embedded WebSocket broadcast — v0.4
 *
 * Forwards broadcast messages to the main WS server via HTTP POST.
 * No separate WebSocket server needed — avoids port conflicts.
 *
 * Used by Next.js API routes (same process) to push to browser clients.
 */

import http from 'http';

const WS_PORT = process.env.WS_PORT || '3001';
const BROADCAST_URL = `http://127.0.0.1:${WS_PORT}/broadcast`;

/** Fire-and-forget HTTP POST to main WS server /broadcast endpoint */
function httpPost(urlStr: string, body: Record<string, unknown>): void {
  try {
    const data = JSON.stringify(body);
    const u = new URL(urlStr);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => { res.resume(); });
    req.on('error', () => { /* WS server may not be running */ });
    req.write(data);
    req.end();
  } catch { /* ignore */ }
}

/** Broadcast a message to all connected browser clients via the main WS server */
export function broadcastWs(type: string, data: Record<string, unknown> = {}): void {
  httpPost(BROADCAST_URL, { type, ...data, timestamp: new Date().toISOString() });
}
