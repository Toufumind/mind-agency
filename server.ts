/**
 * Terminal WebSocket server
 * Passes raw claude CLI TUI to xterm.js
 */
import { createServer } from 'http';
import { parse } from 'url';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.PORT || '3001');
const AGENTS_DIR = path.join(process.cwd(), 'Agents');

const sessions = new Map<string, { child: ChildProcess; ws: WebSocket }>();

function spawnAgentTerminal(ws: WebSocket, agentName: string) {
  const agentDir = path.join(AGENTS_DIR, agentName);
  if (!fs.existsSync(agentDir)) { ws.close(4001, 'Not found'); return; }

  const old = sessions.get(agentName);
  if (old) { old.child.kill(); sessions.delete(agentName); }

  const isWin = process.platform === 'win32';

  const child = spawn(isWin ? 'claude.cmd' : 'claude', [], {
    cwd: agentDir,
    env: {
      ...process.env,
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN || '',
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '',
      ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'DeepSeek-V4-Pro',
      ANTHROPIC_SMALL_FAST_MODEL: 'DeepSeek-V4-Flash',
      HOME: process.env.HOME || process.env.USERPROFILE || '',
      FORCE_COLOR: '1',
      NO_COLOR: '',
      TERM: 'xterm-256color',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: isWin,
  });

  sessions.set(agentName, { child, ws });

  const send = (data: Buffer) => { if (ws.readyState === WebSocket.OPEN) ws.send(data); };
  child.stdout.on('data', send);
  child.stderr.on('data', send);

  ws.on('message', (raw: Buffer) => {
    if (child.stdin.writable) child.stdin.write(raw);
  });

  ws.on('close', () => { child.kill(); sessions.delete(agentName); });
  child.on('exit', () => { sessions.delete(agentName); ws.close(); });
  child.on('error', (err) => { send(Buffer.from(`\r\n\x1b[31m${err.message}\x1b[0m\r\n`)); sessions.delete(agentName); ws.close(); });
}

const server = createServer((_req, res) => { res.writeHead(200); res.end('Mind Agency Terminal'); });
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const { pathname } = parse(request.url || '');
  const match = pathname?.match(/^\/ws\/([a-zA-Z0-9_-]+)$/);
  if (!match) { socket.destroy(); return; }

  wss.handleUpgrade(request, socket, head, (ws) => {
    const agentName = match[1];
    ws.on('close', () => {
      const s = sessions.get(agentName);
      if (s) { s.child.kill(); sessions.delete(agentName); }
    });
    spawnAgentTerminal(ws, agentName);
  });
});

server.listen(PORT, () => console.log(`  Terminal WS: ws://localhost:${PORT}`));
