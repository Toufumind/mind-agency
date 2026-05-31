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

/** 扫描群聊里是否有 @agent 的消息 */
function checkGroupMentions(agentName: string): string {
  const parts: string[] = [];
  const groupsDir = path.join(process.cwd(), 'Groups');
  if (!fs.existsSync(groupsDir)) return '';

  for (const g of fs.readdirSync(groupsDir, { withFileTypes: true })) {
    if (!g.isDirectory() || g.name.startsWith('.')) continue;
    const agentDir = path.join(groupsDir, g.name, 'Agents', agentName);
    if (!fs.existsSync(agentDir)) continue;
    const chatDir = path.join(groupsDir, g.name, 'chat');
    if (!fs.existsSync(chatDir)) continue;

    const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.md')).sort().slice(-2);
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(chatDir, f), 'utf-8');
        const lastBlock = raw.split(/\n(?=---\nfrom:)/).pop() || '';
        if (lastBlock.includes('@' + agentName) || lastBlock.includes(agentName)) {
          const from = (lastBlock.match(/from:\s*(.+)/)?.[1] || '').trim();
          const body = (lastBlock.split('\n---\n\n')[1] || lastBlock).slice(0, 200);
          parts.push(`${g.name}群 ${from}: ${body}`);
        }
      } catch {}
    }
  }
  return parts.join('\n');
}

export async function autoRespond(agentName: string): Promise<{
  triggered: boolean; reply?: string; reason?: string; emailFrom?: string; emailSubject?: string;
}> {
  const config = getConfig(agentName);

  // Check emails
  const emails = await getUnprocessedEmails(agentName);
  const processedEmails = getProcessedCache(agentName);
  const skipSenders = ['system', 'monitoring'];

  let latestEmail = null;
  for (const e of emails) {
    if (skipSenders.includes(e.from.toLowerCase())) continue;
    if (!processedEmails.has(e.filename)) {
      latestEmail = e;
      processedEmails.add(e.filename);
      saveProcessedCache(agentName, processedEmails);
      break;
    }
  }

  // Check group mentions — only active if autoRespondToEmail is on (reuse the toggle)
  let groupMentions = '';
  if (config.autoRespondToEmail) {
    groupMentions = checkGroupMentions(agentName);
  }

  // Nothing to respond to
  if (!latestEmail && !groupMentions) {
    return { triggered: false, reason: config.autoRespondToEmail ? 'no new emails or @mentions' : 'autoRespondToEmail disabled' };
  }

  const prompt = `自动轮询触发。

${latestEmail ? `新邮件 — 发件人: ${latestEmail.from}, 主题: ${latestEmail.subject}\n${latestEmail.body.slice(0, 500)}` : '暂无新邮件。'}
${groupMentions ? `群聊@你：${groupMentions}` : ''}

如果邮件或群聊要求你做某事，就去做（回复、发群消息、发邮件）。
如果只是通知不需要行动，回复"无行动项"。
只用沟通方式，不写代码。用中文。`;

  try {
    const { reply } = await chatOnce(agentName, prompt);
    return {
      triggered: true, reply,
      emailFrom: latestEmail?.from || 'group-mention',
      emailSubject: latestEmail?.subject || 'group chat',
    };
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
