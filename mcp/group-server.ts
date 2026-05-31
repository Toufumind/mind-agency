#!/usr/bin/env node
/**
 * Group MCP Server for Mind Agency
 * One instance shared across all agents (agent name passed as CLI arg)
 *
 * Tools:
 *   group_list  — list groups the agent belongs to
 *   group_send  — post to Groups/<group>/chat/YYYY-MM-DD.md
 *   group_read  — read recent chat from date-named .md files
 *   group_join  — create Agents/<name>/email/
 *   group_leave — delete Agents/<name>/ directory
 */
import { createInterface } from 'readline';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { writeAudit, checkPermission } from '../src/lib/audit.js';

const WS_BROADCAST_URL = process.env.WS_BROADCAST_URL || 'http://localhost:3001/broadcast';

/** Fire-and-forget broadcast to WebSocket clients */
function broadcast(msg: Record<string, unknown>) {
  try {
    const body = JSON.stringify({ ...msg, timestamp: new Date().toISOString() });
    const u = new URL(WS_BROADCAST_URL);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => { res.resume(); });
    req.on('error', () => { /* WS server may not be running */ });
    req.write(body);
    req.end();
  } catch { /* ignore */ }
}

const PROJECT_ROOT = process.env.MIND_PROJECT_ROOT || process.cwd();

function groupsDir() { return path.join(PROJECT_ROOT, 'Groups'); }
function exists(p: string) { return fs.existsSync(p); }
function readDir(p: string) { return exists(p) ? fs.readdirSync(p, { withFileTypes: true }) : []; }

function getAgentGroups(agentName: string): string[] {
  const gd = groupsDir();
  if (!exists(gd)) return [];
  return readDir(gd)
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .filter(e => exists(path.join(gd, e.name, 'Agents', agentName)))
    .map(e => e.name);
}

interface ChatMsg { from: string; date: string; body: string; }

function readGroupChat(groupName: string, limit = 20): ChatMsg[] {
  const chatDir = path.join(groupsDir(), groupName, 'chat');
  if (!exists(chatDir)) return [];
  // Read .md files sorted by date, take last 3 days
  const files = readDir(chatDir)
    .filter(f => f.name.endsWith('.md'))
    .map(f => f.name)
    .sort()
    .slice(-3);
  const msgs: ChatMsg[] = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(chatDir, f), 'utf-8');
      const blocks = raw.split(/\n(?=---\nfrom:)/);
      for (const block of blocks) {
        const fmMatch = block.trim().match(/^---\nfrom:\s*(.+?)\ndate:\s*(.+?)\n---\n\n([\s\S]*)/);
        if (fmMatch) msgs.push({ from: fmMatch[1].trim(), date: fmMatch[2].trim(), body: fmMatch[3].trim() });
      }
    } catch { /* skip */ }
  }
  return msgs.slice(-limit);
}

function appendToChat(group: string, from: string, message: string) {
  const chatDir = path.join(groupsDir(), group, 'chat');
  if (!exists(chatDir)) fs.mkdirSync(chatDir, { recursive: true });
  const date = new Date().toISOString().split('T')[0];
  const entry = `\n---\nfrom: ${from}\ndate: ${new Date().toISOString()}\n---\n\n${message}\n`;
  fs.appendFileSync(path.join(chatDir, `${date}.md`), entry, 'utf-8');
}

let agentName = '';

const tools = [
  { name: 'group_list', description: '列出你所在的所有群组。', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'group_send', description: '向群组发送消息。写入 Groups/<group>/chat/YYYY-MM-DD.md。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, message: { type: 'string' } }, required: ['group', 'message'] } },
  { name: 'group_read', description: '读取群组最近的聊天记录。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, limit: { type: 'number' } }, required: ['group'] } },
  { name: 'group_join', description: '加入群组。创建 Groups/<group>/Agents/<you>/email/。', inputSchema: { type: 'object', properties: { group: { type: 'string' } }, required: ['group'] } },
  { name: 'group_create', description: '创建一个新的群组。会在 Groups/<name>/ 下创建完整的目录结构（Agents/<you>/email/ + chat/ + TASK_SPEC.md）。创建者自动加入该群组。', inputSchema: { type: 'object', properties: { group: { type: 'string' } }, required: ['group'] } },
  { name: 'group_leave', description: '退出群组。删除 Groups/<group>/Agents/<you>/。', inputSchema: { type: 'object', properties: { group: { type: 'string' } }, required: ['group'] } },
];

const rl = createInterface({ input: process.stdin });

rl.on('line', (line: string) => {
  if (!line.trim()) return;
  let req: any;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;

  try {
    if (method === 'initialize') { respond(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mind-agency-group-mcp', version: '1.0.0' } }); return; }
    if (method === 'notifications/initialized') return;
    if (method === 'tools/list') { respond(id, { tools }); return; }

    if (method === 'tools/call') {
      const name = params?.name;
      const a = params?.arguments || {};

      if (name === 'group_list') {
        const groups = getAgentGroups(agentName);
        const result = groups.map(g => {
          const agDir = path.join(groupsDir(), g, 'Agents');
          const members = exists(agDir) ? readDir(agDir).filter(e => e.isDirectory()).map(e => e.name) : [];
          const lastMsg = readGroupChat(g, 1)[0];
          return { group: g, members, groupEmail: `Groups/${g}/Agents/${agentName}/email/`, lastMessage: lastMsg ? `${lastMsg.from}: ${lastMsg.body.slice(0, 60)}` : null };
        });
        respond(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        return;
      }

      if (name === 'group_send') {
        const { group, message } = a;
        if (!group || !message) { respond(id, { content: [{ type: 'text', text: 'group and message required' }], isError: true }); return; }
        appendToChat(group, agentName, message);
        broadcast({ type: 'group_message', group, from: agentName, message });
        writeAudit({ agent: agentName, action: 'group.send', resource: `group:${group}`, details: message.slice(0, 200) });
        respond(id, { content: [{ type: 'text', text: `sent to ${group}` }] });
        return;
      }

      if (name === 'group_read') {
        const { group, limit } = a;
        if (!group) { respond(id, { content: [{ type: 'text', text: 'group required' }], isError: true }); return; }
        const msgs = readGroupChat(group, limit || 20);
        respond(id, { content: [{ type: 'text', text: msgs.length ? JSON.stringify(msgs, null, 2) : `${group} has no messages` }] });
        return;
      }

      if (name === 'group_join') {
        const { group } = a;
        if (!group) { respond(id, { content: [{ type: 'text', text: 'group required' }], isError: true }); return; }
        const gDir = path.join(groupsDir(), group);
        if (!exists(gDir)) { respond(id, { content: [{ type: 'text', text: `group "${group}" not found` }], isError: true }); return; }
        const agDir = path.join(gDir, 'Agents', agentName);
        if (exists(agDir)) { respond(id, { content: [{ type: 'text', text: `already in ${group}` }] }); return; }
        fs.mkdirSync(path.join(agDir, 'email'), { recursive: true });
        appendToChat(group, 'system', `${agentName} joined the group`);
        writeAudit({ agent: agentName, action: 'group.join', resource: `group:${group}` });
        const others = exists(path.join(gDir, 'Agents')) ? readDir(path.join(gDir, 'Agents')).filter(e => e.isDirectory() && e.name !== agentName).map(e => e.name) : [];
        respond(id, { content: [{ type: 'text', text: `joined ${group}. members: ${others.join(', ') || 'none'}` }] });
        return;
      }

      if (name === 'group_leave') {
        const { group } = a;
        if (!group) { respond(id, { content: [{ type: 'text', text: 'group required' }], isError: true }); return; }
        const agDir = path.join(groupsDir(), group, 'Agents', agentName);
        if (!exists(agDir)) { respond(id, { content: [{ type: 'text', text: `not in ${group}` }] }); return; }
        appendToChat(group, 'system', `${agentName} left the group`);
        fs.rmSync(agDir, { recursive: true, force: true });
        writeAudit({ agent: agentName, action: 'group.leave', resource: `group:${group}` });
        respond(id, { content: [{ type: 'text', text: `left ${group}` }] });
        return;
      }

      if (name === 'group_create') {
        const { group } = a;
        if (!group) { respond(id, { content: [{ type: 'text', text: 'group name required' }], isError: true }); return; }
        if (!checkPermission(agentName, 'canCreateGroup')) {
          respond(id, { content: [{ type: 'text', text: `permission denied: ${agentName} does not have canCreateGroup permission` }], isError: true });
          writeAudit({ agent: agentName, action: 'group.create', resource: `group:${group}`, details: 'permission denied', status: 'error' });
          return;
        }
        const gDir = path.join(groupsDir(), group);
        if (exists(gDir)) { respond(id, { content: [{ type: 'text', text: `group "${group}" already exists` }], isError: true }); return; }
        // Create group structure
        fs.mkdirSync(path.join(gDir, 'Agents', agentName, 'email'), { recursive: true });
        fs.mkdirSync(path.join(gDir, 'chat'), { recursive: true });
        // Write default TASK_SPEC
        const spec = `# 任务流转规范\n\n任务在 work/<group>/ 下按目录流转，**文件位置即状态**。\n\n## 目录结构\n\n\`\`\`\nwork/<group>/\n├── inbox/                  # 待分配\n├── assigned/<agent>/       # 各 Agent 的工作队列\n└── done/                   # 已完成\n\`\`\`\n\n## 状态流转\n\n\`\`\`\ninbox/ → assigned/<agent>/ → done/\n  ↓           ↓                  ↓\n new      in_progress          done\n\`\`\``;
        fs.writeFileSync(path.join(gDir, 'TASK_SPEC.md'), spec, 'utf-8');
        // Welcome message in chat
        const today = new Date().toISOString().split('T')[0];
        const chatFile = path.join(gDir, 'chat', `${today}.md`);
        fs.appendFileSync(chatFile, `\n---\nfrom: system\ndate: ${new Date().toISOString()}\n---\n\n${group} 群组已创建。${agentName} 是创建者。\n`, 'utf-8');
        writeAudit({ agent: agentName, action: 'group.create', resource: `group:${group}` });
        respond(id, { content: [{ type: 'text', text: `created group "${group}". You are now a member.` }] });
        return;
      }

      respond(id, { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true });
      return;
    }

    respond(id, { content: [{ type: 'text', text: `unknown: ${method}` }], isError: true });
  } catch (e: any) { respond(id, { content: [{ type: 'text', text: e.message }], isError: true }); }
});

function respond(id: any, result: any) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }

// Parse agent name from args
for (const a of process.argv.slice(2)) { if (!a.startsWith('-') && !a.endsWith('.ts') && !a.endsWith('.js')) { agentName = a; break; } }

process.stderr.write(`[group-mcp] agent=${agentName} project=${PROJECT_ROOT}\n`);
if (exists(groupsDir())) {
  for (const d of readDir(groupsDir()).filter(e => e.isDirectory())) {
    process.stderr.write(`[group-mcp]   ${d.name}/Agents/${agentName}: ${exists(path.join(groupsDir(), d.name, 'Agents', agentName))}\n`);
  }
}
