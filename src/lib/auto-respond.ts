import fs from 'fs';
import path from 'path';
import { chatOnce } from './chat';

const AGENTS_DIR = path.join(process.cwd(), 'Agents');

interface AgentConfig {
  autoRespondToEmail: boolean;
}

function getConfig(agentName: string): AgentConfig {
  const cf = path.join(AGENTS_DIR, agentName, 'config.json');
  if (!fs.existsSync(cf)) return { autoRespondToEmail: false };
  try { return JSON.parse(fs.readFileSync(cf, 'utf-8')); }
  catch { return { autoRespondToEmail: false }; }
}

async function getLatestEmails(agentName: string): Promise<{ filename: string; from: string; subject: string; body: string }[]> {
  const emailDir = path.join(AGENTS_DIR, agentName, 'email');
  if (!fs.existsSync(emailDir)) return [];
  const files = fs.readdirSync(emailDir).filter(f => f.endsWith('.md')).sort();
  const emails: any[] = [];
  for (const f of files.slice(-5)) {
    try {
      const raw = fs.readFileSync(path.join(emailDir, f), 'utf-8');
      const fm = raw.match(/^---\nfrom:\s*(.+?)\nto:\s*(.+?)\nsubject:\s*(.+?)\ndate:\s*(.+?)\n---\n([\s\S]*)/);
      if (fm) {
        emails.push({ filename: f, from: fm[1].trim(), subject: fm[3].trim(), body: fm[5].trim() });
      }
    } catch {}
  }
  return emails;
}

/** Auto-respond: agent reads their latest email and responds */
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

  const emails = await getLatestEmails(agentName);
  if (emails.length === 0) {
    return { triggered: false, reason: 'no emails' };
  }

  const latest = emails[emails.length - 1];

  // Build a prompt: tell the agent about the new email and ask them to process it
  const prompt = `## 新邮件通知

你收到了一封新邮件：

发件人: ${latest.from}
主题: ${latest.subject}
日期: ${new Date().toISOString().split('T')[0]}

邮件正文:
${latest.body}

请阅读这封邮件并根据内容做出适当的回复。如果需要执行操作（如加入群组、回复邮件等），请使用相应的工具。用中文回复。`;

  try {
    const { reply } = await chatOnce(agentName, prompt);
    return { triggered: true, reply, emailFrom: latest.from, emailSubject: latest.subject };
  } catch (e: any) {
    return { triggered: false, reason: e.message };
  }
}
