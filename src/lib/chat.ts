import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';

const AGENTS_DIR = path.join(process.cwd(), 'Agents');

// ── types ──

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

// ── streaming CLI chat ──

/** 返回一个 ReadableStream<ChatEvent>，每个事件实时产出 */
export function createChatStream(agentName: string, userMessage: string): ReadableStream<ChatEvent> {
  const agentDir = path.join(AGENTS_DIR, agentName);
  if (!fs.existsSync(agentDir)) {
    return new ReadableStream({
      start(ctrl) {
        ctrl.enqueue({ type: 'error', content: `Agent "${agentName}" not found`, timestamp: new Date().toISOString() });
        ctrl.enqueue({ type: 'done', content: '', timestamp: new Date().toISOString() });
        ctrl.close();
      }
    });
  }

  const history = getChatHistory(agentName);
  const isNew = !history.sessionId;
  const sessionId = history.sessionId || randomUUID();

  // system prompt file
  const sysFile = path.join(os.tmpdir(), `mind-sys-${sessionId}.txt`);
  const identity = `你的名字是 ${agentName}。你是 Mind Agency 团队的一员。你不能在自己的 email/ 下添加或修改文件。给其他人发邮件时在对方 email/ 下创建 .md 文件。你始终用中文回复。`;
  fs.writeFileSync(sysFile, identity, 'utf-8');

  // message file
  const msgFile = path.join(os.tmpdir(), `mind-msg-${sessionId}.json`);
  fs.writeFileSync(msgFile, JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: userMessage }] },
  }), 'utf-8');

  const isWin = process.platform === 'win32';
  const flags = `-p --output-format stream-json --input-format stream-json --verbose --include-partial-messages --dangerously-skip-permissions ${isNew ? '--session-id' : '--resume'} ${sessionId} --append-system-prompt-file "${sysFile}"`;
  const cmdStr = isWin
    ? `powershell -NoProfile -Command "Get-Content -Encoding UTF8 '${msgFile}' | claude.cmd ${flags}"`
    : `cat "${msgFile}" | claude ${flags}`;

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

      const child = spawn(cmdStr, [], {
        cwd: agentDir, env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 300_000,
        shell: true,
      });

      child.stdout.on('data', (chunk: Buffer) => {
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
                  const evt: ChatEvent = { type: 'thinking', content: block.thinking, timestamp: ts() };
                  ctrl.enqueue(evt);
                  allEvents.push(evt);
                } else if (block.type === 'tool_use') {
                  const evt: ChatEvent = {
                    type: 'tool_use',
                    content: block.name,
                    toolName: block.name,
                    toolInput: JSON.stringify(block.input || {}, null, 2),
                    timestamp: ts(),
                  };
                  ctrl.enqueue(evt);
                  allEvents.push(evt);
                } else if (block.type === 'text' && block.text) {
                  const evt: ChatEvent = { type: 'text', content: block.text, timestamp: ts() };
                  ctrl.enqueue(evt);
                  allEvents.push(evt);
                  fullReply += block.text;
                }
              }
            }

            if (obj.type === 'user' && obj.message?.content) {
              for (const block of obj.message.content) {
                if (block.type === 'tool_result') {
                  const out = typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '');
                  const truncated = out.length > 1000 ? out.slice(0, 1000) + '...' : out;
                  const evt: ChatEvent = { type: 'tool_result', content: truncated, toolOutput: truncated, timestamp: ts() };
                  ctrl.enqueue(evt);
                  allEvents.push(evt);
                }
              }
            }

            if (obj.type === 'result') {
              if (obj.is_error) {
                const evt: ChatEvent = { type: 'error', content: obj.result || 'Unknown error', timestamp: ts() };
                ctrl.enqueue(evt);
                allEvents.push(evt);
              }
            }
          } catch { /* partial line, continue */ }
        }
      });

      let stderrOut = '';
      child.stderr.on('data', (d: Buffer) => { stderrOut += d.toString(); });

      child.on('close', code => {
        try { fs.unlinkSync(sysFile); } catch {}
        try { fs.unlinkSync(msgFile); } catch {}

        if (code !== 0 && !allEvents.length) {
          ctrl.enqueue({ type: 'error', content: stderrOut || `CLI exit ${code}`, timestamp: ts() });
        }

        // Save history
        history.messages.push({ role: 'user', content: userMessage, timestamp: ts() });
        history.messages.push({ role: 'assistant', content: fullReply, events: allEvents, timestamp: ts() });
        history.sessionId = sessionId;
        saveChatHistory(agentName, history);

        ctrl.enqueue({ type: 'done', content: '', timestamp: ts() });
        ctrl.close();
      });

      child.on('error', err => {
        try { fs.unlinkSync(sysFile); } catch {}
        try { fs.unlinkSync(msgFile); } catch {}
        ctrl.enqueue({ type: 'error', content: err.message, timestamp: ts() });
        ctrl.enqueue({ type: 'done', content: '', timestamp: ts() });
        ctrl.close();
      });
    }
  });
}
