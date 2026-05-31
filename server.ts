/**
 * WebSocket notification server for Mind Agency — v0.2 Event Bus integration.
 *
 * Runs alongside `next dev` on port 3001. Provides:
 *   - ws://localhost:3001           Browser clients connect here
 *   - POST /broadcast               Legacy group-chat push (scope-aware routing)
 *   - POST /events                  Event Bus emit endpoint (internal)
 *   - GET  /events/stats            Monitoring endpoint
 *
 * Clients send JSON over WS:
 *   → { type: "subscribe", filter?: {...}, options?: {...} }
 *   ← { type: "subscribed", subId: "uuid" }
 *   → { type: "unsubscribe", subId: "uuid" }
 *   ← { type: "unsubscribed", subId: "uuid" }
 *   ← { type: "event", ...EventMessage }  (pushed by server)
 *   ← { type: "error", code: "E_...", message: "..." }
 *
 * Scope routing:
 *   - POST /broadcast → clients with scope "messages" | "all" | legacy (no sub)
 *   - POST /events    → EventBus.emit() → matching subscribers with scope "events" | "all"
 *
 * Start: npx tsx server.ts   (or via `npm run dev:ws`)
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { EventBus, EventType, EventBusError, createEvent } from './src/lib/event-bus.js';

const PORT = parseInt(process.env.WS_PORT || '3001', 10);

// ── EventBus singleton ───────────────────────────────────────────────────

const bus = new EventBus();

// ── Per-client state ─────────────────────────────────────────────────────

interface ClientState {
  clientId: string;
  ws: WebSocket;
  subscribed: boolean; // whether client has sent 'subscribe' at least once
  scope?: 'events' | 'messages' | 'all'; // derived from first subscribe
  connectedAt: number;
}

const clients = new Map<WebSocket, ClientState>();

// ── HTTP server ──────────────────────────────────────────────────────────

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── GET /events/stats ──────────────────────────────────────────────

  if (req.method === 'GET' && req.url === '/events/stats') {
    const stats = bus.getStats();
    const clientList = [...clients.entries()].map(([ws, state]) => ({
      clientId: state.clientId.slice(0, 8),
      subscribed: state.subscribed,
      scope: state.scope,
      connectedSec: Math.round((Date.now() - state.connectedAt) / 1000),
      readyState: ws.readyState,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...stats, clients: clientList }, null, 2));
    return;
  }

  // ── POST /broadcast (legacy group chat) ────────────────────────────

  if (req.method === 'POST' && req.url === '/broadcast') {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        const payload = JSON.stringify(msg);
        let sent = 0;
        let skipped = 0;

        clients.forEach((state, ws) => {
          if (ws.readyState !== WebSocket.OPEN) return;

          // Scope routing: send to legacy clients + scope "messages" or "all"
          const scope = state.scope;
          if (!state.subscribed || scope === 'messages' || scope === 'all') {
            ws.send(payload);
            sent++;
          } else {
            // scope === "events" — skip group chat messages
            skipped++;
          }
        });

        if (skipped > 0) {
          console.log(
            `[ws] /broadcast: sent to ${sent}, skipped ${skipped} (events-only)`
          );
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, clients: sent }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
      }
    });
    return;
  }

  // ── POST /events (EventBus emit) ───────────────────────────────────

  if (req.method === 'POST' && req.url === '/events') {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const eventInput = JSON.parse(body);

        // Normalize: accept string event type or enum value
        const event = {
          event: eventInput.event as EventType,
          payload: eventInput.payload || {},
          timestamp: eventInput.timestamp || Date.now(),
          source: eventInput.source || 'system',
          id: eventInput.id || randomUUID(),
        };

        try {
          bus.emit(event);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e: any) {
          // Known EventBus errors → 400; unknowns → 500
          const isKnownError = Object.values(EventBusError).some((code) =>
            e.message.includes(code)
          );
          res.writeHead(isKnownError ? 400 : 500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
      }
    });
    return;
  }

  // ── Everything else ────────────────────────────────────────────────

  res.writeHead(404);
  res.end();
});

// ── WebSocket server ─────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  const clientId = randomUUID();
  const remote = (ws as any)._socket?.remoteAddress || 'unknown';

  // Track client state
  const state: ClientState = {
    clientId,
    ws,
    subscribed: false,
    connectedAt: Date.now(),
  };
  clients.set(ws, state);

  console.log(`[ws] client ${clientId.slice(0, 8)}... connected (${remote}), total: ${wss.clients.size}`);

  // ── Emit ws.connect event ──────────────────────────────────────────

  bus.emit(
    createEvent(EventType.WS_CONNECT, { clientId, since: Date.now() }, 'system')
  );

  // ── Welcome message (legacy compat) ────────────────────────────────

  ws.send(
    JSON.stringify({
      type: 'connected',
      clientId,
      timestamp: new Date().toISOString(),
    })
  );

  // ── Handle client messages ─────────────────────────────────────────

  ws.on('message', (data: Buffer) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'E_PARSE',
          message: 'Invalid JSON',
        })
      );
      return;
    }

    // ── subscribe ────────────────────────────────────────────────────

    if (msg.type === 'subscribe') {
      try {
        const subId = bus.subscribe(
          msg.filter,
          msg.options,
          clientId,
          (event) => {
            // Only send if WS is still open
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'event',
                  ...event,
                })
              );
            }
          }
        );

        // Mark client as subscribed and derive scope
        state.subscribed = true;
        const scope = msg.options?.scope || 'events';
        if (!state.scope || state.scope === 'events') {
          // First sub defines scope; "all" overrides
          state.scope = scope;
        } else if (scope === 'all') {
          state.scope = 'all';
        }

        ws.send(
          JSON.stringify({
            type: 'subscribed',
            subId,
            scope: state.scope,
          })
        );

        console.log(
          `[ws] client ${clientId.slice(0, 8)}... subscribed (${subId.slice(0, 8)}...), scope=${state.scope}, filter=${JSON.stringify(msg.filter || 'all')}`
        );
      } catch (e: any) {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: e.message.includes('E_INVALID_FILTER')
              ? EventBusError.E_INVALID_FILTER
              : 'E_SUBSCRIBE_FAILED',
            message: e.message,
          })
        );
      }
      return;
    }

    // ── unsubscribe ──────────────────────────────────────────────────

    if (msg.type === 'unsubscribe') {
      try {
        bus.unsubscribe(msg.subId);
        ws.send(
          JSON.stringify({
            type: 'unsubscribed',
            subId: msg.subId,
          })
        );
      } catch (e: any) {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: e.message.includes('E_SUB_NOT_FOUND')
              ? EventBusError.E_SUB_NOT_FOUND
              : 'E_UNSUBSCRIBE_FAILED',
            message: e.message,
          })
        );
      }
      return;
    }

    // ── ping/pong (keepalive) ────────────────────────────────────────

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      return;
    }

    // ── unknown ──────────────────────────────────────────────────────

    ws.send(
      JSON.stringify({
        type: 'error',
        code: 'E_UNKNOWN_TYPE',
        message: `Unknown message type: "${msg.type}"`,
      })
    );
  });

  // ── Handle disconnect ──────────────────────────────────────────────

  ws.on('close', (code: number, reason: Buffer) => {
    // Emit ws.disconnect event
    bus.emit(
      createEvent(
        EventType.WS_DISCONNECT,
        {
          clientId,
          code,
          reason: reason?.toString() || 'client disconnected',
          since: Date.now(),
        },
        'system'
      )
    );

    // Cleanup EventBus subscriptions
    bus.cleanupClient(clientId);

    // Remove client state
    clients.delete(ws);

    console.log(
      `[ws] client ${clientId.slice(0, 8)}... disconnected (${remote}), total: ${wss.clients.size}`
    );
  });

  // ── Handle errors ──────────────────────────────────────────────────

  ws.on('error', (err: Error) => {
    console.error(`[ws] client error (${clientId.slice(0, 8)}...): ${err.message}`);

    bus.emit(
      createEvent(
        EventType.AGENT_ERROR,
        {
          agent: clientId,
          code: 'WS_ERROR',
          message: err.message,
        },
        'system'
      )
    );
  });
});

// ── Periodic housekeeping ────────────────────────────────────────────────

// Clean up stale clients every 30 seconds
setInterval(() => {
  clients.forEach((state, ws) => {
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      bus.cleanupClient(state.clientId);
      clients.delete(ws);
    }
  });
}, 30000);

// ── Start ────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[ws] WebSocket + EventBus server listening on ws://localhost:${PORT}`);
  console.log(`[ws]   Broadcast:  POST http://localhost:${PORT}/broadcast`);
  console.log(`[ws]   Events:    POST http://localhost:${PORT}/events`);
  console.log(`[ws]   Stats:     GET  http://localhost:${PORT}/events/stats`);
  console.log(`[ws] EventBus v0.2 — 17 event types, 5 error codes`);
});

// ── Graceful shutdown ────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('[ws] Shutting down...');
  bus.destroy();
  wss.close();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[ws] Shutting down...');
  bus.destroy();
  wss.close();
  server.close();
  process.exit(0);
});
