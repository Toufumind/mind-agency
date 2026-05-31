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
    const agDir = path.join(groupsDir, g.name, 'Agents');
    if (!fs.existsSync(agDir)) continue;
    const match = fs.readdirSync(agDir, { withFileTypes: true })
      .find(e => e.isDirectory() && e.name.toLowerCase() === agentName.toLowerCase());
    if (!match) continue;
    const chatDir = path.join(groupsDir, g.name, 'chat');
    if (!fs.existsSync(chatDir)) continue;

    const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.md')).sort().slice(-2);
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(chatDir, f), 'utf-8');
        // Check ALL blocks — not just the last one (mention may have scrolled up)
        const blocks = raw.split(/\n(?=---\nfrom:)/);
        for (const block of blocks) {
          if (block.includes('@' + agentName) || block.includes(agentName)) {
            const from = (block.match(/from:\s*(.+)/)?.[1] || '').trim();
            const body = (block.split('\n---\n\n')[1] || block).slice(0, 200);
            parts.push(`${g.name}群 ${from}: ${body}`);
            break; // One mention per file is enough
          }
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

  // Track what we've already responded to (avoid re-triggering on same mentions)
  if (groupMentions) {
    const mentionHash = require('crypto').createHash('md5').update(groupMentions.slice(0, 120)).digest('hex').slice(0, 8);
    const already = getProcessedCache(agentName);
    if (already.has('@' + mentionHash)) {
      return { triggered: false, reason: 'already responded to this mention' };
    }
    // Mark mention as processed
    already.add('@' + mentionHash);
    saveProcessedCache(agentName, already);
  }

  if (!latestEmail && !groupMentions) {
    return { triggered: false, reason: config.autoRespondToEmail ? 'no new emails or @mentions' : 'autoRespondToEmail disabled' };
  }

  const prompt = `自动轮询触发。

${latestEmail ? `新邮件 — 发件人: ${latestEmail.from}, 主题: ${latestEmail.subject}\n${latestEmail.body.slice(0, 500)}` : '暂无新邮件。'}
${groupMentions ? `群聊@你：${groupMentions}\n你必须用 group_send 在群里回复！` : ''}

操作规则：
- 有人在群里@你 → 必须用 group_send 在群里回复
- 有新邮件要求你做某事 → 执行要求的操作（回复邮件、发群消息等）
- 只是通知不需要行动 → 回复"无行动项"即可
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
