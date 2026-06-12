/**
 * Unified server for Mind Agency — combines WebSocket and HTTP in single process.
 *
 * This replaces the dual-process architecture with a single unified server
 * that shares EventBus and IPC state.
 *
 * Start: npx tsx server.ts   (or via `npm run dev:ws`)
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { EventBus, EventType, EventBusError, createEvent, WorkflowEngine, parseWorkflowYaml, setEventBus } from './src/lib/event-bus.js';
import type { EventMessage, WorkflowRunRecord } from './src/lib/event-bus.js';
import { startScheduler, stopScheduler } from './src/lib/scheduler.js';
import { killAllClaudeProcesses } from './src/lib/chat.js';
import { closeDb } from './src/lib/workflow-checkpoint.js';
import { cancelAllWatchers } from './src/lib/workflow-bridge.js';
import { initConsensusHandlers } from './src/lib/consensus.js';
import { ipcStore, getIPCLock } from './src/lib/ipc.js';
import { EmbeddedWebSocketServer } from './src/lib/ws-server.js';

const PORT = parseInt(process.env.WS_PORT || '3001', 10);
const SERVER_SECRET = process.env.MIND_SERVER_SECRET || '';
const MAX_BODY_SIZE = 1024 * 1024; // 1MB limit for request bodies

// ── Auth helper ──────────────────────────────────────────────────────────

function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  // Skip auth if no secret configured (dev mode)
  if (!SERVER_SECRET) return true;

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${SERVER_SECRET}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return false;
  }
  return true;
}

function readBody(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
  return new Promise((resolve) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Request body too large' }));
        req.destroy();
        resolve(null);
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', () => resolve(null));
  });
}

// ── EventBus singleton ───────────────────────────────────────────────────

const bus = new EventBus();
setEventBus(bus); // v0.4: register singleton for in-process subscribers

// ── WorkflowEngine singleton ───────────────────────────────────────────────

import { ChatStepExecutor } from './src/lib/event-bus.js';
import { getEngine } from './src/lib/workflow-bridge.js';
const workflowEngine = getEngine(bus);
console.log('[server] WorkflowEngine using shared singleton from workflow-bridge');
initConsensusHandlers();

// v1.2: Timeout monitoring — check every 30s for stuck WAITING steps
setInterval(() => {
  try { workflowEngine.checkTimeouts(); } catch {}
}, 30_000);

// ── Embedded WebSocket Server ─────────────────────────────────────────────

const wsServer = new EmbeddedWebSocketServer(bus, PORT);

// ── HTTP Server ──────────────────────────────────────────────────────────

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── CSRF: Origin header check for mutating requests ─────────────────
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    const origin = req.headers.origin;
    if (origin) {
      const allowedOrigins = ['http://127.0.0.1:3000', 'http://localhost:3000'];
      if (!allowedOrigins.includes(origin)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'CSRF: Origin not allowed' }));
        return;
      }
    }
    // Absent Origin is allowed (non-browser clients like curl, MCP)
  }

  // ── GET /health ─────────────────────────────────────────────────────

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      wsClients: wsServer.getClientCount(),
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // ── GET /events/stats ──────────────────────────────────────────────

  if (req.method === 'GET' && req.url === '/events/stats') {
    const stats = bus.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...stats, wsClients: wsServer.getClientCount() }, null, 2));
    return;
  }

  // ── POST /broadcast (legacy group chat) ────────────────────────────

  if (req.method === 'POST' && req.url === '/broadcast') {
    if (!checkAuth(req, res)) return;
    readBody(req, res).then(body => {
      if (body === null) return;
      try {
        const msg = JSON.parse(body);
        const sent = wsServer.broadcast(msg, 'messages');
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
    if (!checkAuth(req, res)) return;
    readBody(req, res).then(body => {
      if (body === null) return;
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

        bus.emit(event);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, eventId: event.id }));
      } catch (e: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── Everything else ────────────────────────────────────────────────
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Not Found', path: req.url, method: req.method }));
});

// ── Start Server ─────────────────────────────────────────────────────────

async function start() {
  // Start HTTP server
  server.listen(PORT + 1, () => {
    console.log(`[server] HTTP server listening on port ${PORT + 1}`);
  });

  // Start WebSocket server
  await wsServer.start();

  // Store server info in IPC
  ipcStore.set('server:startup', Date.now());
  ipcStore.set('server:pid', process.pid);
  ipcStore.set('server:httpPort', PORT + 1);
  ipcStore.set('server:wsPort', PORT);

  // Start scheduler
  startScheduler();

  console.log(`[server] Unified server started (HTTP: ${PORT + 1}, WS: ${PORT})`);
}

// ── Graceful Shutdown ────────────────────────────────────────────────────

async function shutdown() {
  console.log('[server] Shutting down...');

  // Stop scheduler
  stopScheduler();

  // Kill all claude processes
  try { killAllClaudeProcesses(); } catch {}

  // Cancel all watchers
  try { cancelAllWatchers(); } catch {}

  // Close checkpoint DB
  try { closeDb(); } catch {}

  // Stop WebSocket server
  await wsServer.stop();

  // Close HTTP server
  await new Promise<void>((resolve) => {
    server.close(() => {
      console.log('[server] HTTP server closed');
      resolve();
    });
  });

  // Clear IPC state
  ipcStore.delete('server:startup');
  ipcStore.delete('server:pid');

  console.log('[server] Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── Start ────────────────────────────────────────────────────────────────

start().catch((error) => {
  console.error('[server] Failed to start:', error);
  process.exit(1);
});
