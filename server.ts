/**
 * WebSocket notification server for Mind Agency.
 *
 * Runs alongside `next dev` on port 3001. Provides:
 *   - ws://localhost:3001          Browser clients connect here
 *   - POST /broadcast             Internal endpoint to push messages to all clients
 *
 * Start: npx tsx server.ts   (or via `npm run dev:ws`)
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.WS_PORT || '3001', 10);

// ── HTTP server (handles /broadcast + WebSocket upgrades) ──────────────

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  // CORS for internal API calls
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/broadcast') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        const payload = JSON.stringify(msg);
        let sent = 0;
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
            sent++;
          }
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, clients: sent }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
      }
    });
    return;
  }

  // Everything else: 404
  res.writeHead(404);
  res.end();
});

// ── WebSocket server ────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  const remote = (ws as any)._socket?.remoteAddress || 'unknown';
  console.log(`[ws] client connected (${remote}), total: ${wss.clients.size}`);

  ws.on('close', () => {
    console.log(`[ws] client disconnected (${remote}), total: ${wss.clients.size}`);
  });

  ws.on('error', (err: Error) => {
    console.error(`[ws] client error: ${err.message}`);
  });

  // Send a welcome message so the client knows the connection is alive
  ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
});

// ── Start ───────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[ws] WebSocket notification server listening on ws://localhost:${PORT}`);
  console.log(`[ws] Broadcast endpoint: POST http://localhost:${PORT}/broadcast`);
});
