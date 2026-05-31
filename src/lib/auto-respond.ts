import fs from 'fs';
import path from 'path';
import { chatOnce } from './chat';

const AGENTS_DIR = path.join(process.cwd(), 'Agents');

interface AgentConfig {
  autoRespondToEmail: boolean;
  autoProcessGroupInvites: boolean;
  notifyOnEmail: boolean;
  notifyOnGroupMention: boolean;
}

function getConfig(agentName: string): AgentConfig {
  const cf = path.join(AGENTS_DIR, agentName, 'config.json');
  if (!fs.existsSync(cf)) return { autoRespondToEmail: false, autoProcessGroupInvites: false, notifyOnEmail: true, notifyOnGroupMention: true };
  try { return JSON.parse(fs.readFileSync(cf, 'utf-8')); }
  catch { return { autoRespondToEmail: false, autoProcessGroupInvites: false, notifyOnEmail: true, notifyOnGroupMention: true }; }
}

async function getUnprocessedEmails(agentName: string): Promise<{ filename: string; from: string; subject: string; body: string }[]> {
  const emailDir = path.join(AGENTS_DIR, agentName, 'email');
  if (!fs.existsSync(emailDir)) return [];

  const files = fs.readdirSync(emailDir).filter(f => f.endsWith('.md')).sort();
  const emails: any[] = [];

  for (const f of files.slice(-3)) {
    try {
      const raw = fs.readFileSync(path.join(emailDir, f), 'utf-8');
      const fm = raw.match(/^---\nfrom:\s*(.+?)\nto:\s*(.+?)\nsubject:\s*(.+?)\ndate:\s*(.+?)\n---\n([\s\S]*)/);
      if (fm) emails.push({ filename: f, from: fm[1].trim(), subject: fm[3].trim(), body: fm[5].trim() });
    } catch {}
  }
  return emails;
}

// Track which emails have already been processed
const processedEmails = new Set<string>();

export async function autoRespond(agentName: string): Promise<{
  triggered: boolean;
  reply?: string;
  reason?: string;
  emailFrom?: string;
  emailSubject?: string;
}> {
  const config = getConfig(agentName);
  if (!config.autoRespondToEmail) {
    return { triggered: false, reason: 'autoRespondToEmail is disabled' };
  }

  const emails = await getUnprocessedEmails(agentName);
  if (emails.length === 0) {
    return { triggered: false, reason: 'no emails' };
  }

  // Find first unprocessed email
  let latest = null;
  for (const e of emails) {
    const key = `${agentName}:${e.filename}`;
    if (!processedEmails.has(key)) {
      latest = e;
      processedEmails.add(key);
      // Keep set bounded
      if (processedEmails.size > 1000) {
        const it = processedEmails.values();
        for (let i = 0; i < 200; i++) { const n = it.next(); if (n.value) processedEmails.delete(n.value); else break; }
      }
      break;
    }
  }

  if (!latest) {
    return { triggered: false, reason: 'all emails already processed' };
  }

  const prompt = `## 新邮件通知（自动处理）

你收到了一封新邮件。请像真实团队成员一样处理它：

发件人: ${latest.from}
主题: ${latest.subject}

邮件正文:
${latest.body}

请：
1. 阅读并理解邮件内容
2. 执行邮件中要求你做的事情（比如：修复 bug、审查代码、加入群组、回复等）
3. 如果需要通知其他人，给他们发邮件或群聊消息
4. 完成后如果邮件要求你转交给下一个人，务必发送邮件给下一个环节的人

用中文回复。`;

  try {
    const { reply } = await chatOnce(agentName, prompt);
    return { triggered: true, reply, emailFrom: latest.from, emailSubject: latest.subject };
  } catch (e: any) {
    return { triggered: false, reason: e.message };
  }
}

/** Poll all agents with auto-respond enabled, process any new emails */
export async function pollAllAgents(): Promise<{ agent: string; triggered: boolean }[]> {
  const results: { agent: string; triggered: boolean }[] = [];
  if (!fs.existsSync(AGENTS_DIR)) return results;

  const agents = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'));

  for (const a of agents) {
    const config = getConfig(a.name);
    if (!config.autoRespondToEmail) continue;

    try {
      const result = await autoRespond(a.name);
      results.push({ agent: a.name, triggered: result.triggered });
    } catch {
      results.push({ agent: a.name, triggered: false });
    }
  }

  return results;
}
