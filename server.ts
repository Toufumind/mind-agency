/**
 * WebSocket notification server for Mind Agency — v0.3 Event Bus + Workflow integration.
 *
 * Runs alongside `next dev` on port 3001. Provides:
 *   - ws://localhost:3001           Browser clients connect here
 *   - POST /broadcast               Legacy group-chat push (scope-aware routing)
 *   - POST /events                  Event Bus emit endpoint (internal)
 *   - GET  /events/stats            Monitoring + DLQ stats
 *   - GET  /events/dlq              Dead Letter Queue inspection
 *   - POST /events/dlq/retry        Manual DLQ retry trigger
 *   - POST /events/dlq/purge        Clear DLQ
 *   - POST /workflows/run           Execute a workflow definition
 *   - GET  /workflows/stats         Workflow engine stats
 *
 * Clients send JSON over WS:
 *   → { type: "subscribe", filter?: {...}, options?: {...} }
 *   ← { type: "subscribed", subId: "uuid" }
 *   → { type: "unsubscribe", subId: "uuid" }
 *   ← { type: "unsubscribed", subId: "uuid" }
 *   ← { type: "event", ...EventMessage }  (pushed by server)
 *   ← { type: "error", code: "E_...", message: "..." }
 *
 * Start: npx tsx server.ts   (or via `npm run dev:ws`)
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { EventBus, EventType, EventBusError, createEvent, WorkflowEngine, parseWorkflowYaml, setEventBus } from './src/lib/event-bus.js';
import type { EventMessage, WorkflowRunRecord } from './src/lib/event-bus.js';
import { startScheduler, stopScheduler } from './src/lib/scheduler.js';
import { killAllClaudeProcesses } from './src/lib/chat.js';
import { closeDb } from './src/lib/workflow-checkpoint.js';
import { cancelAllWatchers } from './src/lib/workflow-bridge.js';
import { initConsensusHandlers } from './src/lib/consensus.js';

const PORT = parseInt(process.env.WS_PORT || '3001', 10);

// ── EventBus singleton ───────────────────────────────────────────────────

const bus = new EventBus();
setEventBus(bus); // v0.4: register singleton for in-process subscribers

// ── WorkflowEngine singleton ───────────────────────────────────────────────

import { ChatStepExecutor } from './src/lib/event-bus.js';
const useChat = true; // process.env.WORKFLOW_EXECUTOR === 'chat';
const executor = useChat ? new ChatStepExecutor() : undefined;
const workflowEngine = new WorkflowEngine(bus, executor);
if (useChat) console.log('[ws] WorkflowEngine using ChatStepExecutor (real AI)');
initConsensusHandlers();

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

  // ── GET /events/dlq ──────────────────────────────────────────────

  if (req.method === 'GET' && req.url === '/events/dlq') {
    const dlq = bus.getDeadLetters();
    const dlqStats = bus.getDLQStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...dlqStats, entries: dlq }, null, 2));
    return;
  }

  // ── POST /events/dlq/retry ────────────────────────────────────────

  if (req.method === 'POST' && req.url === '/events/dlq/retry') {
    const retried = bus.retryDeadLetters();
    const stats = bus.getDLQStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, retried, remaining: stats.size }));
    return;
  }

  // ── POST /events/dlq/purge ────────────────────────────────────────

  if (req.method === 'POST' && req.url === '/events/dlq/purge') {
    const purged = bus.purgeDeadLetters();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, purged }));
    return;
  }

  // ── GET /events/outbox ────────────────────────────────────────────

  if (req.method === 'GET' && req.url === '/events/outbox') {
    const stats = bus.getOutboxStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats, null, 2));
    return;
  }

  // ── GET /events/load ──────────────────────────────────────────────

  if (req.method === 'GET' && req.url === '/events/load') {
    const load = workflowEngine.getSystemLoad();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(load, null, 2));
    return;
  }

  // ── POST /workflows/approve ───────────────────────────────────────

  if (req.method === 'POST' && req.url === '/workflows/approve') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { approvalId, decision, comment } = JSON.parse(body);
        if (!approvalId || !decision || !['APPROVED', 'REJECTED'].includes(decision)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'requires approvalId and decision (APPROVED|REJECTED)' }));
          return;
        }
        const ok = workflowEngine.submitApproval(approvalId, decision, comment);
        res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ok ? { ok: true, approvalId, decision } : { ok: false, error: 'approval not found' }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
      }
    });
    return;
  }

  // ── GET /workflows/approvals ──────────────────────────────────────

  if (req.method === 'GET' && req.url === '/workflows/approvals') {
    const pending = workflowEngine.listPendingApprovals();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: pending.length, pending }, null, 2));
    return;
  }

  // ── POST /workflows/cancel (v0.4) ───────────────────────────────────

  if (req.method === 'POST' && req.url === '/workflows/cancel') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { runId } = JSON.parse(body);
        if (!runId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'runId required' }));
          return;
        }
        const ok = workflowEngine.cancel(runId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok, message: ok ? `cancelled ${runId.slice(0, 8)}` : 'run not found' }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── POST /workflows/add-step (v0.4) ────────────────────────────────

  if (req.method === 'POST' && req.url === '/workflows/add-step') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { group, step_id, agent, action, prompt, depends_on, reviewer, onReject, maxRejectRetries } = JSON.parse(body);
        if (!group || !step_id || !agent || !action || !prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'group, step_id, agent, action, prompt required' }));
          return;
        }
        const ok = workflowEngine.addStep(group, { id: step_id, agent, action, prompt, dependsOn: depends_on ? depends_on.split(',').map((s: string) => s.trim()) : [], reviewer, onReject, maxRejectRetries });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok, message: ok ? `added step ${step_id}` : 'no running workflow found' }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── POST /workflows/delete-step (v0.4) ─────────────────────────────

  if (req.method === 'POST' && req.url === '/workflows/delete-step') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { group, step_id } = JSON.parse(body);
        if (!group || !step_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'group and step_id required' }));
          return;
        }
        const ok = workflowEngine.deleteStep(group, step_id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok, message: ok ? `deleted step ${step_id}` : 'step not found or running' }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── POST /workflows/modify-step (v0.4) ─────────────────────────────

  if (req.method === 'POST' && req.url === '/workflows/modify-step') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { group, step_id, agent, action, prompt, reviewer, onReject } = JSON.parse(body);
        if (!group || !step_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'group and step_id required' }));
          return;
        }
        const ok = workflowEngine.modifyStep(group, step_id, { agent, action, prompt, reviewer, onReject });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok, message: ok ? `modified step ${step_id}` : 'step not found or already running' }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── POST /workflows/run ───────────────────────────────────────────

  if (req.method === 'POST' && req.url === '/workflows/run') {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const input = JSON.parse(body);
        // Accept raw YAML string or pre-parsed definition
        const def = typeof input.yaml === 'string' ? parseWorkflowYaml(input.yaml) : input;
        if (!def.name || !def.steps?.length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'workflow requires name and steps' }));
          return;
        }
        const run = await workflowEngine.execute(def, input.group);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, runId: run.runId, status: run.status, stepsCompleted: run.steps.size }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── GET /workflows/stats ──────────────────────────────────────────

  if (req.method === 'GET' && req.url === '/workflows/stats') {
    const stats = workflowEngine.getStats();
    const runs = workflowEngine.listRuns().map((r: WorkflowRunRecord) => ({
      runId: r.runId,
      workflowName: r.workflowName,
      status: r.status,
      stepCount: r.steps.size,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...stats, runs }, null, 2));
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
          (event: EventMessage) => {
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
  console.log(`[ws] WebSocket + EventBus + Workflow server on ws://localhost:${PORT}`);
  console.log(`[ws]   Broadcast:  POST http://localhost:${PORT}/broadcast`);
  console.log(`[ws]   Events:    POST http://localhost:${PORT}/events`);
  console.log(`[ws]   Stats:     GET  http://localhost:${PORT}/events/stats`);
  console.log(`[ws]   DLQ:       GET  http://localhost:${PORT}/events/dlq | POST .../dlq/retry | POST .../dlq/purge`);
  console.log(`[ws]   Outbox:    GET  http://localhost:${PORT}/events/outbox`);
  console.log(`[ws]   Workflows: POST http://localhost:${PORT}/workflows/run | GET .../workflows/stats`);
  console.log(`[ws] EventBus v0.3 — DLQ + retry, WorkflowEngine v0.3 — DAG`);

  // ── v0.4: Recover incomplete workflow runs from checkpoints ──
  try {
    const recovered = workflowEngine.recoverCheckpoints();
    if (recovered.length > 0) {
      console.log(`[ws] Recovered ${recovered.length} interrupted workflow run(s):`);
      for (const r of recovered) console.log(`  - ${r.workflowName} (${r.runId.slice(0, 8)}) in ${r.group}`);
    }
  } catch (e: unknown) {
    console.error(`[ws] Checkpoint recovery failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── Start background scheduler (poll + DAG loops) ─────────────────
  startScheduler({
    engine: workflowEngine,
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL || '30000', 10),
    dagIntervalMs: parseInt(process.env.DAG_INTERVAL || '10000', 10),
  });
});

// ── Graceful shutdown ────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('[ws] Shutting down...');
  const killed = killAllClaudeProcesses();
  if (killed > 0) console.log(`[ws] aborted ${killed} active queries`);
  stopScheduler();
  cancelAllWatchers();
  bus.destroy();
  closeDb();
  wss.close();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[ws] Shutting down...');
  const killed = killAllClaudeProcesses();
  if (killed > 0) console.log(`[ws] aborted ${killed} active queries`);
  stopScheduler();
  cancelAllWatchers();
  bus.destroy();
  closeDb();
  wss.close();
  server.close();
  process.exit(0);
});
