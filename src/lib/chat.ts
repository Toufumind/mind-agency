import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

const AGENTS_DIR = path.join(process.cwd(), 'Agents');

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatHistory {
  sessionId: string | null;
  messages: ChatMessage[];
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

export async function chatWithAgent(
  agentName: string,
  userMessage: string
): Promise<{ reply: string; sessionId: string }> {
  const agentDir = path.join(AGENTS_DIR, agentName);
  if (!fs.existsSync(agentDir)) {
    throw new Error(`Agent "${agentName}" not found`);
  }

  const history = getChatHistory(agentName);
  const now = new Date().toISOString();
  history.messages.push({ role: 'user', content: userMessage, timestamp: now });

  const isNew = !history.sessionId;
  const sessionId = history.sessionId || randomUUID();

  // 写临时文件避免 shell 编码问题
  const sysFile = path.join(os.tmpdir(), `mind-sys-${sessionId}.txt`);
  const msgFile = path.join(os.tmpdir(), `mind-msg-${sessionId}.json`);

  const identity = `你的名字是 ${agentName}。你是 Mind Agency 团队的一员。你的 email 在 Agents/${agentName}/email/。你不能在自己的 email 文件夹添加/修改文件。给其他人发邮件时在对方 email/ 下创建 .md 文件。`;
  fs.writeFileSync(sysFile, identity, 'utf-8');

  const msgJson = JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: userMessage }],
    },
  });
  fs.writeFileSync(msgFile, msgJson, 'utf-8');

  const isWin = process.platform === 'win32';

  // Windows: 用 PowerShell 管道（原生 UTF-8）
  // Unix: cat 管道
  const baseFlags = `-p --output-format stream-json --input-format stream-json --verbose --include-partial-messages --dangerously-skip-permissions ${isNew ? '--session-id' : '--resume'} ${sessionId} --append-system-prompt-file "${sysFile}"`;
  const cmdStr = isWin
    ? `powershell -NoProfile -Command "Get-Content -Encoding UTF8 '${msgFile}' | claude.cmd ${baseFlags}"`
    : `cat "${msgFile}" | claude ${baseFlags}`;

  const reply = await new Promise<string>((resolve, reject) => {
    const child = spawn(cmdStr, [], {
      cwd: agentDir,
      env: {
        ...process.env,
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

    let result = '';
    let stderrOut = '';

    child.stdout.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'result' && msg.subtype === 'success' && msg.result) {
            result = msg.result;
          }
        } catch { /* skip */ }
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
      resolve(result || '');
    });

    child.on('error', reject);
  });

  history.messages.push({
    role: 'assistant',
    content: reply,
    timestamp: new Date().toISOString(),
  });
  history.sessionId = sessionId;
  saveChatHistory(agentName, history);

  return { reply, sessionId };
}
