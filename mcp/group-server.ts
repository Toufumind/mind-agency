#!/usr/bin/env node
/**
 * Group MCP Server for Mind Agency
 *
 * Tools:
 *   group_list  — list groups the agent belongs to
 *   group_send  — post message to group chat (append to chat.md)
 *   group_read  — read recent group chat messages
 *   group_join  — join a group (create Agents/<name>/email/)
 *   group_leave  — leave a group (delete Agents/<name>/ directory)
 */
import { createInterface } from 'readline';
import fs from 'fs';
import path from 'path';

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
  const chatFile = path.join(groupsDir(), groupName, 'chat', 'chat.md');
  if (!exists(chatFile)) return [];
  try {
    const raw = fs.readFileSync(chatFile, 'utf-8');
    const blocks = raw.split(/\n(?=---\nfrom:)/);
    const msgs: ChatMsg[] = [];
    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const fmMatch = trimmed.match(/^---\nfrom:\s*(.+?)\ndate:\s*(.+?)\n---\n\n([\s\S]*)/);
      if (fmMatch) {
        msgs.push({ from: fmMatch[1].trim(), date: fmMatch[2].trim(), body: fmMatch[3].trim() });
      }
    }
    return msgs.slice(-limit);
  } catch { return []; }
}

let agentName = '';

const tools = [
  {
    name: 'group_list',
    description: '列出你所在的所有群组。返回群组名称、成员列表和群邮箱路径。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'group_send',
    description: '向指定群组发送一条消息。消息追加到 Groups/<group>/chat/chat.md 中。',
    inputSchema: {
      type: 'object',
      properties: {
        group: { type: 'string', description: '群组名称' },
        message: { type: 'string', description: '消息内容 (Markdown)' },
      },
      required: ['group', 'message'],
    },
  },
  {
    name: 'group_read',
    description: '查看指定群组的聊天记录。返回最近 N 条消息。',
    inputSchema: {
      type: 'object',
      properties: {
        group: { type: 'string', description: '群组名称' },
        limit: { type: 'number', description: '返回最近 N 条消息，默认 20' },
      },
      required: ['group'],
    },
  },
  {
    name: 'group_join',
    description: '加入一个群组。会在 Groups/<group>/Agents/<you>/ 下创建你的目录和 email 收件箱。加入后你就能收到群消息、在群里发言。',
    inputSchema: {
      type: 'object',
      properties: { group: { type: 'string', description: '要加入的群组名称' } },
      required: ['group'],
    },
  },
  {
    name: 'group_leave',
    description: '退出一个群组。这会删除你在 Groups/<group>/Agents/<you>/ 下的所有数据（包括群邮箱）。退出后将不再接收群消息。',
    inputSchema: {
      type: 'object',
      properties: { group: { type: 'string', description: '要退出的群组名称' } },
      required: ['group'],
    },
  },
];

const rl = createInterface({ input: process.stdin });

rl.on('line', (line: string) => {
  if (!line.trim()) return;
  let request: any;
  try { request = JSON.parse(line); } catch { return; }

  const { id, method, params } = request;

  try {
    if (method === 'initialize') {
      respond(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mind-agency-group-mcp', version: '1.0.0' } });
      return;
    }
    if (method === 'notifications/initialized') return;

    if (method === 'tools/list') { respond(id, { tools }); return; }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};

      if (toolName === 'group_list') {
        const groups = getAgentGroups(agentName);
        const result: any[] = [];
        for (const g of groups) {
          const agDir = path.join(groupsDir(), g, 'Agents');
          const members = exists(agDir)
            ? readDir(agDir).filter(e => e.isDirectory()).map(e => e.name)
            : [];
          const chatMsgs = readGroupChat(g, 1);
          result.push({
            group: g, members,
            groupEmailPath: `Groups/${g}/Agents/${agentName}/email/`,
            recentActivity: chatMsgs.length > 0 ? `${chatMsgs[0].from}: ${chatMsgs[0].body.slice(0, 60)}` : null,
          });
        }
        respond(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        return;
      }

      if (toolName === 'group_send') {
        const { group, message } = args;
        if (!group || !message) { respond(id, { content: [{ type: 'text', text: 'Error: group and message are required' }], isError: true }); return; }
        const chatDir = path.join(groupsDir(), group, 'chat');
        if (!exists(chatDir)) fs.mkdirSync(chatDir, { recursive: true });
        const entry = `\n---\nfrom: ${agentName}\ndate: ${new Date().toISOString()}\n---\n\n${message}\n`;
        fs.appendFileSync(path.join(chatDir, 'chat.md'), entry, 'utf-8');
        respond(id, { content: [{ type: 'text', text: `消息已发送到 ${group} 群聊` }] });
        return;
      }

      if (toolName === 'group_read') {
        const { group, limit } = args;
        if (!group) { respond(id, { content: [{ type: 'text', text: 'Error: group name is required' }], isError: true }); return; }
        const msgs = readGroupChat(group, limit || 20);
        if (msgs.length === 0) { respond(id, { content: [{ type: 'text', text: `${group} 群聊暂无消息。` }] }); return; }
        respond(id, { content: [{ type: 'text', text: JSON.stringify(msgs, null, 2) }] });
        return;
      }

      if (toolName === 'group_join') {
        const { group } = args;
        if (!group) { respond(id, { content: [{ type: 'text', text: 'Error: group name is required' }], isError: true }); return; }
        const groupDir = path.join(groupsDir(), group);
        if (!exists(groupDir)) { respond(id, { content: [{ type: 'text', text: `群组 "${group}" 不存在` }], isError: true }); return; }
        const agentDir = path.join(groupDir, 'Agents', agentName);
        if (exists(agentDir)) { respond(id, { content: [{ type: 'text', text: `你已经加入了 ${group} 群组` }] }); return; }
        fs.mkdirSync(path.join(agentDir, 'email'), { recursive: true });
        const chatDir = path.join(groupDir, 'chat');
        if (!exists(chatDir)) fs.mkdirSync(chatDir, { recursive: true });
        fs.appendFileSync(path.join(chatDir, 'chat.md'), `\n---\nfrom: system\ndate: ${new Date().toISOString()}\n---\n\n${agentName} 加入了群组。\n`, 'utf-8');
        const others = exists(path.join(groupDir, 'Agents'))
          ? readDir(path.join(groupDir, 'Agents')).filter(e => e.isDirectory() && e.name !== agentName).map(e => e.name)
          : [];
        respond(id, { content: [{ type: 'text', text: `已加入 ${group} 群组。成员: ${others.join(', ') || '暂无'}` }] });
        return;
      }

      if (toolName === 'group_leave') {
        const { group } = args;
        if (!group) { respond(id, { content: [{ type: 'text', text: 'Error: group name is required' }], isError: true }); return; }
        const agentDir = path.join(groupsDir(), group, 'Agents', agentName);
        if (!exists(agentDir)) { respond(id, { content: [{ type: 'text', text: `你不在 ${group} 群组中` }] }); return; }
        const chatDir = path.join(groupsDir(), group, 'chat');
        if (!exists(chatDir)) fs.mkdirSync(chatDir, { recursive: true });
        fs.appendFileSync(path.join(chatDir, 'chat.md'), `\n---\nfrom: system\ndate: ${new Date().toISOString()}\n---\n\n${agentName} 退出了群组。\n`, 'utf-8');
        fs.rmSync(agentDir, { recursive: true, force: true });
        respond(id, { content: [{ type: 'text', text: `已退出 ${group} 群组，相关数据已清除` }] });
        return;
      }

      respond(id, { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true });
      return;
    }

    respond(id, { content: [{ type: 'text', text: `Unknown method: ${method}` }], isError: true });
  } catch (error: any) {
    respond(id, { content: [{ type: 'text', text: `Internal error: ${error.message}` }], isError: true });
  }
});

function respond(id: any, result: any) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

// Parse agent name from args
const rawArgs = process.argv.slice(2);
for (const a of rawArgs) {
  if (!a.endsWith('.ts') && !a.endsWith('.js') && !a.startsWith('-')) { agentName = a; break; }
}

process.stderr.write(`[group-mcp] Agent: ${agentName}, Project: ${PROJECT_ROOT}\n`);
if (exists(groupsDir())) {
  for (const d of readDir(groupsDir()).filter(e => e.isDirectory())) {
    process.stderr.write(`[group-mcp]   ${d.name}/Agents/${agentName}: ${exists(path.join(groupsDir(), d.name, 'Agents', agentName))}\n`);
  }
}
