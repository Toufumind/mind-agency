import fs from 'fs';
import path from 'path';

const AGENTS_DIR = path.join(process.cwd(), 'Agents');

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatSession {
  messages: ChatMessage[];
}

/** 读取 Agent 的聊天历史 */
export function getChatHistory(agentName: string): ChatSession {
  const chatDir = path.join(AGENTS_DIR, agentName, 'chat');
  const historyFile = path.join(chatDir, 'history.json');

  if (!fs.existsSync(historyFile)) {
    return { messages: [] };
  }

  try {
    const raw = fs.readFileSync(historyFile, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { messages: [] };
  }
}

/** 保存聊天历史 */
export function saveChatHistory(agentName: string, session: ChatSession) {
  const chatDir = path.join(AGENTS_DIR, agentName, 'chat');
  if (!fs.existsSync(chatDir)) {
    fs.mkdirSync(chatDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(chatDir, 'history.json'),
    JSON.stringify(session, null, 2),
    'utf-8'
  );
}

/** 读取 Agent 的 CLAUDE.md 规则 */
export function getAgentRules(agentName: string): string {
  const agentDir = path.join(AGENTS_DIR, agentName);
  const paths = [
    path.join(agentDir, 'CLAUDE.md'),
    path.join(agentDir, '.claude', 'CLAUDE.md'),
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf-8');
    }
  }
  return '';
}

/** 扫描团队其他成员 */
export function getTeamMembers(agentName: string): string[] {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  return fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== agentName)
    .map(e => e.name);
}

/** 构建 Agent 的系统提示词 */
export function buildSystemPrompt(agentName: string): string {
  const rules = getAgentRules(agentName);
  const others = getTeamMembers(agentName);

  return `You are ${agentName}. You are a member of the Mind Agency team.

Your working directory has:
- email/ folder — your personal inbox (read-only: you can view and delete emails, but NOT add or modify files in your own email/)
- ../ — parent directory contains team members: ${others.join(', ')}
- CLAUDE.md — your rules (loaded below)

${rules || ''}

## IMPORTANT: Email system rules
1. You can READ and DELETE emails in your own email/ folder, but CANNOT add or modify files there
2. To send a message to another team member, create a .md file in THEIR email/ folder
3. Email format (use YAML frontmatter):
\`\`\`
---
from: ${agentName}
to: <recipient>
subject: <subject>
date: <YYYY-MM-DD>
---

<message body in Markdown>
\`\`\`
4. Filename format: YYYY-MM-DD_short_subject.md

You are chatting with a human colleague. Be helpful, direct, and collaborative. You can send emails on their behalf if they ask.`;
}
