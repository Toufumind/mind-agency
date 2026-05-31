import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { randomUUID, createHash } from 'crypto';

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

// ── Stable file helpers (KV cache optimization) ──

/** 写入文件，仅在内容变化时才真正写磁盘（保持 mtime 不变 → cache 命中） */
function writeIfChanged(filePath: string, content: string): boolean {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf-8');
    if (existing === content) return false; // 内容没变，不写
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return true; // 内容变了
}

// Cache files go in .mind/ (not in Agents/ — avoid data pollution)
const MIND_DIR = path.join(process.cwd(), '.mind');

/** Agent 的稳定系统提示词文件路径（不随 session 变化） */
function agentSysFile(agentName: string): string {
  return path.join(MIND_DIR, 'agents', agentName, 'sys-prompt.md');
}

/** 项目级共享 MCP 配置 —— 所有 Agent 用同一个 */
function sharedMcpFile(): string {
  return path.join(MIND_DIR, 'mcp-config.json');
}

// ── Build system prompt components ──

/** 基础身份 + 邮件规则 — 几乎不变，放在稳定文件里 */
function buildIdentity(agentName: string): string {
  return `你的名字是 ${agentName}。你是 Mind Agency 团队的一员。

你不能在自己的 email/ 下添加或修改文件。
给其他人发邮件时在对方 email/ 下创建 .md 文件（YAML frontmatter + Markdown）。
邮件文件名格式: YYYY-MM-DD_主题.md
你始终用中文回复。`;
}

/** Group 成员信息 — 只在 join/leave group 时变化 */
function buildGroupMembership(agentName: string): string {
  const GroupsDir = path.join(process.cwd(), 'Groups');
  if (!fs.existsSync(GroupsDir)) return '';

  const myGroups: string[] = [];
  for (const g of fs.readdirSync(GroupsDir, { withFileTypes: true })) {
    if (!g.isDirectory() || g.name.startsWith('.')) continue;
    if (fs.existsSync(path.join(GroupsDir, g.name, 'Agents', agentName))) {
      myGroups.push(g.name);
    }
  }
  if (myGroups.length === 0) return '';

  const lines: string[] = ['\n## 你所属的 Groups'];
  for (const gn of myGroups) {
    const agDir = path.join(GroupsDir, gn, 'Agents');
    const members = fs.existsSync(agDir)
      ? fs.readdirSync(agDir, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== agentName).map(e => e.name)
      : [];
    const emailDir = path.join(agDir, agentName, 'email');
    const emailCount = fs.existsSync(emailDir)
      ? fs.readdirSync(emailDir).filter(f => f.endsWith('.md')).length
      : 0;
    lines.push(`- Groups/${gn}/ — 成员: ${members.join(', ') || '只有你'}`);
    lines.push(`  Group 邮箱: Groups/${gn}/Agents/${agentName}/email/ (${emailCount} 封)`);
    const spec = path.join(GroupsDir, gn, 'TASK_SPEC.md');
    if (fs.existsSync(spec)) lines.push(`  任务流转规则: Groups/${gn}/TASK_SPEC.md`);
  }
  return lines.join('\n') + '\n';
}

/** 群聊上下文 — 从 Groups/<name>/chat/ 下日期 .md 文件读取 */
function buildGroupChatContext(agentName: string, groupName?: string): string {
  if (!groupName) return '';
  const chatDir = path.join(process.cwd(), 'Groups', groupName, 'chat');
  if (!fs.existsSync(chatDir)) {
    return `\n\n## 你正在 ${groupName} 群聊中。暂无消息。用 group_send 发言。`;
  }
  try {
    // Read last 3 days of chat files
    const files = fs.readdirSync(chatDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .slice(-3);
    if (files.length === 0) {
      return `\n\n## 你正在 ${groupName} 群聊中。暂无消息。用 group_send 发言。`;
    }
    const parts: string[] = [];
    for (const f of files) {
      const raw = fs.readFileSync(path.join(chatDir, f), 'utf-8');
      parts.push(`### ${f.replace('.md', '')}\n${raw}`);
    }
    const text = parts.join('\n\n');
    const ctx = text.length > 6000 ? '...(earlier omitted)\n\n' + text.slice(-6000) : text;
    return `\n\n## 你正在 ${groupName} 群聊中。最近消息：\n\n${ctx}\n\n用 group_send 工具发言。`;
  } catch {
    return `\n\n## 你正在 ${groupName} 群聊中。暂无消息。`;
  }
}

// ── Main stream ──

export function createChatStream(agentName: string, userMessage: string, groupName?: string): ReadableStream<ChatEvent> {
  const agentDir = path.join(AGENTS_DIR, agentName);
  if (!fs.existsSync(agentDir)) {
    return quickError(`Agent "${agentName}" not found`);
  }

  const history = getChatHistory(agentName);
  const isNew = !history.sessionId;
  const sessionId = history.sessionId || randomUUID();

  // ── KV Cache Optimization ─────────────────────────────
  // 原则：文件路径稳定 → content hash 不变不重写 → mtime 不变 → cache hit
  //
  // 拆成三个文件，各自独立更新：
  //   1. sys-prompt.md    — 身份 + Group 成员（几乎不变）
  //   2. chat-context.md  — 群聊上下文（每轮可能变）
  //   3. mcp-config.json  — MCP 配置（不变）
  // ──────────────────────────────────────────────────────

  const sysFile = agentSysFile(agentName);
  const mcpCfgFile = sharedMcpFile();

  // 1. 身份 + Group 成员 — 只在 join/leave group 时变化
  const identity = buildIdentity(agentName);
  const membership = buildGroupMembership(agentName);
  const groupChat = buildGroupChatContext(agentName, groupName);
  // Stable part (identity + membership): cached, rarely changes
  // Group chat context: always appended, changes per message
  const content = identity + '\n' + membership + groupChat;
  writeIfChanged(sysFile, content);

  // 2. MCP 配置 — 完全不变
  // Windows: use cmd.exe /c to launch npx.cmd (needed because npx is a .cmd batch file)
  const isWin = process.platform === 'win32';
  const mcpServerPath = path.resolve(process.cwd(), 'mcp/group-server.ts');
  const mcpConfig = {
    mcpServers: {
      'group-chat': isWin ? {
        command: 'cmd.exe',
        args: ['/c', 'npx.cmd', 'tsx', mcpServerPath, agentName],
        cwd: process.cwd(),
        env: { MIND_PROJECT_ROOT: process.cwd() },
      } : {
        command: 'npx',
        args: ['tsx', mcpServerPath, agentName],
        cwd: process.cwd(),
        env: { MIND_PROJECT_ROOT: process.cwd() },
      },
    },
  };
  writeIfChanged(mcpCfgFile, JSON.stringify(mcpConfig, null, 2));

  // ── Build claude args ──
  const claudeExe = isWin
    ? path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    : 'claude';

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose', '--include-partial-messages',
    '--dangerously-skip-permissions',
    // 把动态信息移到 user message 中（cwd/git status），让 system prompt 更稳定
    '--exclude-dynamic-system-prompt-sections',
    isNew ? '--session-id' : '--resume', sessionId,
    // 稳定文件用 = 形式避免被当作位置参数
    `--mcp-config=${mcpCfgFile}`,
    '--append-system-prompt-file', sysFile,
    userMessage, // 必须是最后一个 — 位置参数
  ];

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
          } catch { /* partial line */ }
        }
      });

      let stderrOut = '';
      child.stderr?.on('data', (d: Buffer) => { stderrOut += d.toString(); });

      child.on('close', code => {
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
