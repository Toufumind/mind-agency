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

// Persist processed email set per agent to disk (survives restarts)
function getProcessedCache(agentName: string): Set<string> {
  const cacheFile = path.join(AGENTS_DIR, agentName, '.auto-respond-cache.json');
  try {
    if (fs.existsSync(cacheFile)) {
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      return new Set(data.processed || []);
    }
  } catch {}
  return new Set();
}

function saveProcessedCache(agentName: string, set: Set<string>) {
  const cacheFile = path.join(AGENTS_DIR, agentName, '.auto-respond-cache.json');
  // Keep only last 50 entries
  const arr = [...set].slice(-50);
  fs.writeFileSync(cacheFile, JSON.stringify({ processed: arr, updated: new Date().toISOString() }), 'utf-8');
}

async function getUnprocessedEmails(agentName: string): Promise<{ filename: string; from: string; subject: string; body: string }[]> {
  const emailDir = path.join(AGENTS_DIR, agentName, 'email');
  if (!fs.existsSync(emailDir)) return [];
  const files = fs.readdirSync(emailDir).filter(f => f.endsWith('.md')).sort();
  const emails: any[] = [];

  for (const f of files.slice(-5)) {
    try {
      const raw = fs.readFileSync(path.join(emailDir, f), 'utf-8');
      const fm = raw.match(/^---\nfrom:\s*(.+?)\nto:\s*(.+?)\nsubject:\s*(.+?)\ndate:\s*(.+?)\n---\n([\s\S]*)/);
      if (fm) emails.push({ filename: f, from: fm[1].trim(), subject: fm[3].trim(), body: fm[5].trim() });
    } catch {}
  }
  return emails;
}

export async function autoRespond(agentName: string): Promise<{
  triggered: boolean;
  reply?: string;
  reason?: string;
  emailFrom?: string;
  emailSubject?: string;
}> {
  const config = getConfig(agentName);
  if (!config.autoRespondToEmail) {
    return { triggered: false, reason: 'autoRespondToEmail disabled' };
  }

  const emails = await getUnprocessedEmails(agentName);
  if (emails.length === 0) {
    return { triggered: false, reason: 'no emails' };
  }

  const processedEmails = getProcessedCache(agentName);

  // Skip system-generated emails
  const skipSenders = ['system', 'monitoring'];
  let latest = null;
  for (const e of emails) {
    if (skipSenders.includes(e.from.toLowerCase())) continue;
    const key = e.filename;
    if (!processedEmails.has(key)) {
      latest = e;
      processedEmails.add(key);
      saveProcessedCache(agentName, processedEmails);
      break;
    }
  }

  if (!latest) {
    return { triggered: false, reason: 'all emails processed' };
  }

  const prompt = `## 新邮件通知（自动处理）

收到新邮件：
发件人: ${latest.from} | 主题: ${latest.subject}

${latest.body}

请：
1. 阅读邮件内容
2. 执行邮件中要求的操作（回复邮件、用 group_send 通知群聊等）
3. 如需要通知下一个人，务必发邮件或群聊消息
4. 除非邮件明确要求你改代码，否则用沟通方式（邮件/群聊）处理

用中文回复。`;

  try {
    const { reply } = await chatOnce(agentName, prompt);
    return { triggered: true, reply, emailFrom: latest.from, emailSubject: latest.subject };
  } catch (e: any) {
    return { triggered: false, reason: e.message };
  }
}

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
