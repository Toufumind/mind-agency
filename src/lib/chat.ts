import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

const AGENTS_DIR = path.join(process.cwd(), 'Agents');

// ── types ──

export interface ChatEvent {
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'error';
  content: string;          // thinking/text content or tool result summary
  toolName?: string;        // for tool_use
  toolInput?: string;       // JSON string of tool input
  toolOutput?: string;      // truncated tool result
  timestamp: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  events?: ChatEvent[];
  timestamp: string;
}

export interface ChatHistory {
  sessionId: string | null;
  messages: ChatMessage[];
}

// ── persistence ──

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

// ── CLI chat ──

export async function chatWithAgent(
  agentName: string,
  userMessage: string
): Promise<{ reply: string; events: ChatEvent[]; sessionId: string }> {
  const agentDir = path.join(AGENTS_DIR, agentName);
  if (!fs.existsSync(agentDir)) {
    throw new Error(`Agent "${agentName}" not found`);
  }

  const history = getChatHistory(agentName);
  const now = new Date().toISOString();

  const isNew = !history.sessionId;
  const sessionId = history.sessionId || randomUUID();

  // system prompt file
  const sysFile = path.join(os.tmpdir(), `mind-sys-${sessionId}.txt`);
  const identity = `你的名字是 ${agentName}。你是 Mind Agency 团队的一员。你不能在自己的 email/ 下添加/修改文件。给其他人发邮件时在对方 email/ 下创建 .md 文件（frontmatter + markdown）。你始终用中文回复。`;
  fs.writeFileSync(sysFile, identity, 'utf-8');

  // message file
  const msgFile = path.join(os.tmpdir(), `mind-msg-${sessionId}.json`);
  const msgJson = JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: userMessage }],
    },
  });
  fs.writeFileSync(msgFile, msgJson, 'utf-8');

  const isWin = process.platform === 'win32';
  const flags = `-p --output-format stream-json --input-format stream-json --verbose --include-partial-messages --dangerously-skip-permissions ${isNew ? '--session-id' : '--resume'} ${sessionId} --append-system-prompt-file "${sysFile}"`;
  const cmdStr = isWin
    ? `powershell -NoProfile -Command "Get-Content -Encoding UTF8 '${msgFile}' | claude.cmd ${flags}"`
    : `cat "${msgFile}" | claude ${flags}`;

  const { reply, events } = await new Promise<{ reply: string; events: ChatEvent[] }>((resolve, reject) => {
    const child = spawn(cmdStr, [], {
      cwd: agentDir,
      env: { ...process.env,
        ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN || '',
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '',
        ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'DeepSeek-V4-Pro',
        ANTHROPIC_SMALL_FAST_MODEL: 'DeepSeek-V4-Flash',
        HOME: process.env.HOME || process.env.USERPROFILE || '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000,
      shell: true,
    });

    let replyText = '';
    const events: ChatEvent[] = [];
    let stderrOut = '';
    const ts = () => new Date().toISOString();

    child.stdout.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);

          if (obj.type === 'assistant' && obj.message?.content) {
            for (const block of obj.message.content) {
              if (block.type === 'thinking' && block.thinking) {
                events.push({ type: 'thinking', content: block.thinking, timestamp: ts() });
              } else if (block.type === 'tool_use') {
                events.push({
                  type: 'tool_use',
                  content: block.name || '',
                  toolName: block.name,
                  toolInput: JSON.stringify(block.input || {}, null, 2),
                  timestamp: ts(),
                });
              } else if (block.type === 'text' && block.text) {
                replyText += block.text;
                events.push({ type: 'text', content: block.text, timestamp: ts() });
              }
            }
          }

          if (obj.type === 'user' && obj.message?.content) {
            for (const block of obj.message.content) {
              if (block.type === 'tool_result') {
                const output = typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content || '');
                const truncated = output.length > 600 ? output.slice(0, 600) + '...' : output;
                events.push({
                  type: 'tool_result',
                  content: truncated,
                  toolOutput: truncated,
                  timestamp: ts(),
                });
              }
            }
          }

          if (obj.type === 'result') {
            if (obj.subtype === 'success' && obj.result) {
              replyText = obj.result;
            } else if (obj.is_error && obj.result) {
              events.push({ type: 'error', content: obj.result, timestamp: ts() });
            }
          }
        } catch { /* skip partial */ }
      }
    });

    child.stderr.on('data', (d: Buffer) => { stderrOut += d.toString(); });

    child.on('close', code => {
      try { fs.unlinkSync(sysFile); } catch {}
      try { fs.unlinkSync(msgFile); } catch {}

      if (code !== 0) {
        reject(new Error(stderrOut || `CLI exit ${code}`));
        return;
      }
      resolve({ reply: replyText, events });
    });

    child.on('error', reject);
  });

  // 保存到历史
  history.messages.push({
    role: 'user',
    content: userMessage,
    timestamp: now,
  });
  history.messages.push({
    role: 'assistant',
    content: reply,
    events,
    timestamp: new Date().toISOString(),
  });
  history.sessionId = sessionId;
  saveChatHistory(agentName, history);

  return { reply, sessionId, events };
}
