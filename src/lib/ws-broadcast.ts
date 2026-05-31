/**
 * Utility to broadcast messages to all connected WebSocket clients.
 *
 * This makes an HTTP POST to the WS server's /broadcast endpoint.
 * Works from both Next.js API routes (same machine) and the MCP group-server.
 */

const WS_BROADCAST_URL = process.env.WS_BROADCAST_URL || 'http://localhost:3001/broadcast';

export interface WSBroadcastMessage {
  type: 'group_message' | 'new_email' | 'connected';
  group?: string;
  from?: string;
  to?: string;
  subject?: string;
  message?: string;
  timestamp?: string;
}

/**
 * Send a message to the WebSocket broadcast endpoint.
 * Fire-and-forget — never throws, logs errors to stderr.
 */
export function broadcastToClients(msg: WSBroadcastMessage): void {
  const body = JSON.stringify({ ...msg, timestamp: msg.timestamp || new Date().toISOString() });

  // Use built-in http to avoid extra dependencies
  const url = new URL(WS_BROADCAST_URL);
  const http = url.protocol === 'https:' ? require('https') : require('http');

  const req = http.request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    (res: any) => {
      // Consume response to avoid memory leaks
      res.resume();
    }
  );

  req.on('error', (err: Error) => {
    // WS server may not be running — that's fine, just log
    console.error(`[ws-broadcast] failed: ${err.message}`);
  });

  req.write(body);
  req.end();
}
