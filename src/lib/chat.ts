import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

const AGENTS_DIR = path.join(process.cwd(), 'Agents');

export interface ChatEvent {
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'done' | 'error';
  content?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  timestamp: string;
}

export interface ChatHistory {
  sessionId: string | null;
  messages: { role: 'user' | 'assistant'; content: string; events?: ChatEvent[]; timestamp: string }[];
}

export function getChatHistory(agentName: string): ChatHistory {
  const file = sessionFile(agentName);
  if (!fs.existsSync(file)) return { sessionId: null, messages: [] };
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return { sessionId: null, messages: [] }; }
}

function saveChatHistory(agentName: string, data: ChatHistory) {
  const dir = path.join(AGENTS_DIR, agentName, 'chat');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionFile(agentName), JSON.stringify(data, null, 2), 'utf-8');
}

export function clearChat(agentName: string) {
  const file = sessionFile(agentName);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function sessionFile(agentName: string) {
  return path.join(AGENTS_DIR, agentName, 'chat', 'session.json');
}

export function createChatStream(agentName: string, userMessage: string): ReadableStream<ChatEvent> {
  const agentDir = path.join(AGENTS_DIR, agentName);
  if (!fs.existsSync(agentDir)) {
    return quickError(`Agent "${agentName}" not found`);
  }

  const history = getChatHistory(agentName);
  const isNew = !history.sessionId;
  const sessionId = history.sessionId || randomUUID();

  const sysFile = path.join(os.tmpdir(), `mind-sys-${sessionId}.txt`);
  const mcpConfigFile = path.join(os.tmpdir(), `mind-mcp-${sessionId}.json`);

  // 写 MCP 配置文件（每个 agent 独立，用于加载 Group MCP Server）
  const mcpConfig = {
    mcpServers: {
      'group-chat': {
        command: 'npx',
        args: ['tsx', path.resolve(process.cwd(), 'mcp/group-server.ts'), agentName],
        cwd: process.cwd(),
        env: {
          MIND_PROJECT_ROOT: process.cwd(),
        },
      },
    },
  };
  fs.writeFileSync(mcpConfigFile, JSON.stringify(mcpConfig, null, 2), 'utf-8');

  // 扫描 Groups/*/Agents/ 发现 agent 的 group 归属
  let groupContext = '';
  const GroupsDir = path.join(process.cwd(), 'Groups');
  if (fs.existsSync(GroupsDir)) {
    const groupEntries = fs.readdirSync(GroupsDir, { withFileTypes: true }).filter(e => e.isDirectory());
    const myGroups: string[] = [];

    for (const g of groupEntries) {
      const agentInGroup = path.join(GroupsDir, g.name, 'Agents', agentName);
      if (fs.existsSync(agentInGroup)) {
        myGroups.push(g.name);
      }
    }

    if (myGroups.length > 0) {
      const lines: string[] = [];
      lines.push(`\n## 你所属的 Groups`);
      for (const gn of myGroups) {
        // 该 group 下还有哪些其他成员
        const groupAgentsDir = path.join(GroupsDir, gn, 'Agents');
        const members = fs.readdirSync(groupAgentsDir, { withFileTypes: true })
          .filter(e => e.isDirectory() && e.name !== agentName)
          .map(e => e.name);
        lines.push(`- Groups/${gn}/ — 成员: ${members.join(', ') || '只有你'}`);
        // 检查 group 下的 email
        const groupEmailDir = path.join(groupAgentsDir, agentName, 'email');
        if (fs.existsSync(groupEmailDir)) {
          const count = fs.readdirSync(groupEmailDir).filter(f => f.endsWith('.md')).length;
          lines.push(`  此 group 邮箱: Groups/${gn}/Agents/${agentName}/email/ (${count} 封)`);
        }
        // TASK_SPEC
        const specFile = path.join(GroupsDir, gn, 'TASK_SPEC.md');
        if (fs.existsSync(specFile)) {
          lines.push(`  任务规则: Groups/${gn}/TASK_SPEC.md`);
        }
      }
      groupContext = lines.join('\n') + '\n';
    }
  }

  const identity = `你的名字是 ${agentName}。你是 Mind Agency 团队的一员。

你不能在自己的 email/ 下添加或修改文件。给其他人发邮件时在对方 email/ 下创建 .md 文件。你始终用中文回复。

${groupContext}`;
  fs.writeFileSync(sysFile, identity, 'utf-8');

  const isWin = process.platform === 'win32';
  // Write the stream-json input to a file so we can redirect stdin without encoding issues
  const env = {
    ...process.env,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN || '',
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '',
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'DeepSeek-V4-Pro',
    ANTHROPIC_SMALL_FAST_MODEL: 'DeepSeek-V4-Flash',
    HOME: process.env.HOME || process.env.USERPROFILE || '',
  };

  const ts = () => new Date().toISOString();

  return new ReadableStream<ChatEvent>({
    start(ctrl) {
      let buffer = '';
      let fullReply = '';
      const allEvents: ChatEvent[] = [];

      // Use claude.exe directly — verified stable with UTF-8 positional args
      // env includes DeepSeek config (same as claude-deepseek-zhijiao wrapper)
      const claudeExe = isWin
        ? path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
        : 'claude';

      const args = [
        '-p',
        '--output-format', 'stream-json',
        '--verbose', '--include-partial-messages',
        '--dangerously-skip-permissions',
        isNew ? '--session-id' : '--resume', sessionId,
        '--append-system-prompt-file', sysFile,
        userMessage,
        '--mcp-config', mcpConfigFile,
      ];

      const child = spawn(claudeExe, args, {
        cwd: agentDir, env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 300_000,
      });

      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);

            if (obj.type === 'assistant' && obj.message?.content) {
              for (const block of obj.message.content) {
                if (block.type === 'thinking' && block.thinking) {
                  const e: ChatEvent = { type: 'thinking', content: block.thinking, timestamp: ts() };
                  ctrl.enqueue(e); allEvents.push(e);
                } else if (block.type === 'tool_use') {
                  const e: ChatEvent = { type: 'tool_use', content: block.name, toolName: block.name, toolInput: JSON.stringify(block.input || {}, null, 2), timestamp: ts() };
                  ctrl.enqueue(e); allEvents.push(e);
                } else if (block.type === 'text' && block.text) {
                  const e: ChatEvent = { type: 'text', content: block.text, timestamp: ts() };
                  ctrl.enqueue(e); allEvents.push(e);
                  fullReply += block.text;
                }
              }
            }

            if (obj.type === 'user' && obj.message?.content) {
              for (const block of obj.message.content) {
                if (block.type === 'tool_result') {
                  const out = typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '');
                  const e: ChatEvent = { type: 'tool_result', content: out.slice(0, 1000), toolOutput: out.slice(0, 1000), timestamp: ts() };
                  ctrl.enqueue(e); allEvents.push(e);
                }
              }
            }

            if (obj.type === 'result' && obj.is_error) {
              ctrl.enqueue({ type: 'error', content: obj.result || 'Unknown error', timestamp: ts() });
            }
          } catch { /* partial */ }
        }
      });

      let stderrOut = '';
      child.stderr?.on('data', (d: Buffer) => { stderrOut += d.toString(); });

      child.on('close', code => {
        try { fs.unlinkSync(sysFile); } catch {}
        try { fs.unlinkSync(mcpConfigFile); } catch {}
        if (code !== 0 && !allEvents.length) {
          ctrl.enqueue({ type: 'error', content: stderrOut || `CLI exit ${code}`, timestamp: ts() });
        }
        history.messages.push({ role: 'user', content: userMessage, timestamp: ts() });
        history.messages.push({ role: 'assistant', content: fullReply, events: allEvents, timestamp: ts() });
        history.sessionId = sessionId;
        saveChatHistory(agentName, history);
        ctrl.enqueue({ type: 'done', content: '', timestamp: ts() });
        ctrl.close();
      });

      child.on('error', err => {
        try { fs.unlinkSync(sysFile); } catch {}
        try { fs.unlinkSync(mcpConfigFile); } catch {}
        ctrl.enqueue({ type: 'error', content: err.message, timestamp: ts() });
        ctrl.enqueue({ type: 'done', content: '', timestamp: ts() });
        ctrl.close();
      });
    }
  });
}

function quickError(msg: string): ReadableStream<ChatEvent> {
  const ts = new Date().toISOString();
  return new ReadableStream({
    start(c) { c.enqueue({ type: 'error', content: msg, timestamp: ts }); c.enqueue({ type: 'done', content: '', timestamp: ts }); c.close(); }
  });
}
