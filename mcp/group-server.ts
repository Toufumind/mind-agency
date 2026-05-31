#!/usr/bin/env node
/**
 * Group MCP Server for Mind Agency
 *
 * Provides atomic group chat operations:
 *   - group_send   → post messages to group chat
 *   - group_list   → list groups the agent belongs to
 *   - group_read   → read recent group chat messages
 *
 * Protocol: MCP JSON-RPC over stdio
 */
import { createInterface } from 'readline';
import fs from 'fs';
import path from 'path';

// ── Config ──
const PROJECT_ROOT = process.env.MIND_PROJECT_ROOT || process.cwd();

// ── Helpers ──
function groupsDir() { return path.join(PROJECT_ROOT, 'Groups'); }
function exists(p: string) { return fs.existsSync(p); }
function readDir(p: string) { return exists(p) ? fs.readdirSync(p, { withFileTypes: true }) : []; }

// ── Scan for agent's group memberships ──
function getAgentGroups(agentName: string): string[] {
  const gd = groupsDir();
  if (!exists(gd)) return [];
  return readDir(gd)
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .filter(e => exists(path.join(gd, e.name, 'Agents', agentName)))
    .map(e => e.name);
}

// ── Read group chat ──
interface ChatMsg { from: string; date: string; body: string; }
function readGroupChat(groupName: string, limit = 20): ChatMsg[] {
  const chatFile = path.join(groupsDir(), groupName, 'chat', 'chat.md');
  if (!exists(chatFile)) return [];
  try {
    const raw = fs.readFileSync(chatFile, 'utf-8');
    // Split by frontmatter blocks: each starts with "---\nfrom:"
    const blocks = raw.split(/\n(?=---\nfrom:)/);
    const msgs: ChatMsg[] = [];
    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const fmMatch = trimmed.match(/^---\nfrom:\s*(.+?)\ndate:\s*(.+?)\n---\n\n([\s\S]*)/);
      if (fmMatch) {
        msgs.push({
          from: fmMatch[1].trim(),
          date: fmMatch[2].trim(),
          body: fmMatch[3].trim(),
        });
      }
    }
    return msgs.slice(-limit);
  } catch { return []; }
}

// ── MCP JSON-RPC ──
let agentName = '';

const tools = [
  {
    name: 'group_list',
    description: '列出你所在的所有群组。返回群组名称、成员列表和群邮箱路径。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'group_send',
    description: '向群组发送消息。消息会写入 Groups/<group>/chat/ 目录下，以 .md 文件存储。',
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
    description: '读取群组聊天记录。返回最近的 N 条消息。加入群聊时使用此工具获取上下文。',
    inputSchema: {
      type: 'object',
      properties: {
        group: { type: 'string', description: '群组名称' },
        limit: { type: 'number', description: '返回最近 N 条消息，默认 20' },
      },
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
      respond(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'mind-agency-group-mcp',
          version: '1.0.0',
        },
      });
      return;
    }

    if (method === 'notifications/initialized') {
      // No response needed
      return;
    }

    if (method === 'tools/list') {
      respond(id, { tools });
      return;
    }

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
            group: g,
            members,
            groupEmailPath: `Groups/${g}/Agents/${agentName}/email/`,
            recentActivity: chatMsgs.length > 0
              ? `${chatMsgs[0].from}: ${chatMsgs[0].body.slice(0, 60)}`
              : null,
          });
        }
        respond(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
        return;
      }

      if (toolName === 'group_send') {
        const { group, message } = args;
        if (!group || !message) {
          respond(id, {
            content: [{ type: 'text', text: 'Error: group and message are required' }],
            isError: true,
          });
          return;
        }
        const chatDir = path.join(groupsDir(), group, 'chat');
        if (!exists(chatDir)) fs.mkdirSync(chatDir, { recursive: true });
        // Append to chat.md (single file, not individual files)
        const chatFile = path.join(chatDir, 'chat.md');
        const entry = `\n---\nfrom: ${agentName}\ndate: ${new Date().toISOString()}\n---\n\n${message}\n`;
        fs.appendFileSync(chatFile, entry, 'utf-8');
        respond(id, {
          content: [{ type: 'text', text: `消息已发送到 ${group} 群聊` }],
        });
        return;
      }

      if (toolName === 'group_read') {
        const { group, limit } = args;
        if (!group) {
          respond(id, {
            content: [{ type: 'text', text: 'Error: group name is required' }],
            isError: true,
          });
          return;
        }
        const msgs = readGroupChat(group, limit || 20);
        if (msgs.length === 0) {
          respond(id, {
            content: [{ type: 'text', text: `${group} 群聊暂无消息。` }],
          });
          return;
        }
        respond(id, {
          content: [
            { type: 'text', text: JSON.stringify(msgs, null, 2) },
          ],
        });
        return;
      }

      // Unknown tool
      respond(id, {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      });
      return;
    }

    // Unknown method
    respond(id, {
      content: [{ type: 'text', text: `Unknown method: ${method}` }],
      isError: true,
    });
  } catch (error: any) {
    respond(id, {
      content: [{ type: 'text', text: `Internal error: ${error.message}` }],
      isError: true,
    });
  }
});

function respond(id: any, result: any) {
  const response = { jsonrpc: '2.0', id, result };
  process.stdout.write(JSON.stringify(response) + '\n');
}

// Accept agent name from command line (first arg that's not the script path)
const rawArgs = process.argv.slice(2);
for (const a of rawArgs) {
  if (!a.endsWith('.ts') && !a.endsWith('.js') && !a.startsWith('-')) {
    agentName = a;
    break;
  }
}

// Log to stderr (not stdout — stdout is JSON-RPC)
process.stderr.write(`[group-mcp] Agent: ${agentName}, Project: ${PROJECT_ROOT}\n`);
process.stderr.write(`[group-mcp] Groups dir exists: ${exists(groupsDir())}\n`);
if (exists(groupsDir())) {
  const dirs = readDir(groupsDir()).filter(e => e.isDirectory());
  process.stderr.write(`[group-mcp] Group dirs: ${dirs.map(d => d.name).join(', ')}\n`);
  for (const d of dirs) {
    const agPath = path.join(groupsDir(), d.name, 'Agents', agentName);
    process.stderr.write(`[group-mcp]   ${agPath}: ${exists(agPath)}\n`);
  }
}
