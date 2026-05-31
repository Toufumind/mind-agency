/**
 * Terminal WebSocket server
 * Uses claude in stream-json mode for reliable pipe communication
 */
import { createServer } from 'http';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.PORT || '3001');
const AGENTS_DIR = path.join(process.cwd(), 'Agents');

const sessions = new Map<string, { child: ChildProcess; ws: WebSocket }>();

function safeSend(ws: WebSocket, data: string | Buffer) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(typeof data === 'string' ? data : Buffer.from(data)); } catch {}
  }
}

function spawnAgent(ws: WebSocket, agentName: string) {
  const agentDir = path.join(AGENTS_DIR, agentName);
  if (!fs.existsSync(agentDir)) { ws.close(4001, 'Not found'); return; }

  // Kill old
  const old = sessions.get(agentName);
  if (old) { old.child.kill(); sessions.delete(agentName); }

  const isWin = process.platform === 'win32';
  const claudeBin = isWin ? 'claude.cmd' : 'claude';

  const child = spawn(claudeBin, [
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
  ], {
    cwd: agentDir,
    env: {
      ...process.env,
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN || '',
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '',
      ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'DeepSeek-V4-Pro',
      ANTHROPIC_SMALL_FAST_MODEL: 'DeepSeek-V4-Flash',
      HOME: process.env.HOME || process.env.USERPROFILE || '',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: isWin,
  });

  sessions.set(agentName, { child, ws });
  console.log(`[${agentName}] Claude started`);

  // Send init event to start the session
  const initMsg = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] } }) + '\n';
  child.stdin.write(initMsg);

  // stdout → parse + forward to browser
  let buffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        // Forward ALL raw lines so frontend can display whatever it wants
        safeSend(ws, line + '\n');

        // If this is the result, the session is done for this turn
        // Don't close — keep session alive for next input
      } catch {
        // Partial line, just forward
        safeSend(ws, line + '\n');
      }
    }
  });

  // stderr
  child.stderr.on('data', (chunk: Buffer) => {
    safeSend(ws, `\x1b[33m${chunk.toString()}\x1b[0m`);
  });

  // Input from browser → send as stream-json user message
  ws.on('message', (raw: Buffer) => {
    try {
      const text = raw.toString().trim();
      if (!text) return;
      const msg = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text }] },
      }) + '\n';
      child.stdin.write(msg);
    } catch {}
  });

  ws.on('close', () => { child.kill(); sessions.delete(agentName); });
  child.on('exit', () => { sessions.delete(agentName); ws.close(); });
}

const server = createServer((_req, res) => { res.writeHead(200); res.end('Mind Agency'); });
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  const match = pathname.match(/^\/ws\/([a-zA-Z0-9_-]+)$/);
  if (!match) { socket.destroy(); return; }
  wss.handleUpgrade(request, socket, head, (ws) => {
    spawnAgent(ws, match[1]);
  });
});

server.listen(PORT, () => console.log(`  Terminal WS: ws://localhost:${PORT}`));
