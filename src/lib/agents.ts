import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import type { Agent, Email, AgentStats, AgentConfig } from '@/types';
import { AGENTS_DIR } from './data-dir';

/** 扫描 Agents/ 目录，返回所有 Agent 列表 */
export function getAgents(): Agent[] {
  if (!fs.existsSync(AGENTS_DIR)) {
    return [];
  }

  const entries = fs.readdirSync(AGENTS_DIR, { withFileTypes: true });
  const agents: Agent[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

    const agentPath = path.join(AGENTS_DIR, entry.name);
    const emailPath = path.join(agentPath, 'email');

    // 确保 email 目录存在
    if (!fs.existsSync(emailPath)) {
      fs.mkdirSync(emailPath, { recursive: true });
    }

    const emailFiles = fs.readdirSync(emailPath).filter(f => f.endsWith('.md'));
    const emailCount = emailFiles.length;

    // 读取 CLAUDE.md 规则
    let rulesContent = '';
    const claudeMdPath = path.join(agentPath, 'CLAUDE.md');
    const claudeMdAlt = path.join(agentPath, '.claude', 'CLAUDE.md');
    if (fs.existsSync(claudeMdPath)) {
      rulesContent = fs.readFileSync(claudeMdPath, 'utf-8');
    } else if (fs.existsSync(claudeMdAlt)) {
      rulesContent = fs.readFileSync(claudeMdAlt, 'utf-8');
    }

    // 读取 config.json
    let config: AgentConfig | undefined;
    const configPath = path.join(agentPath, 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch { /* ignore parse errors */ }
    }

    agents.push({
      name: entry.name,
      emailPath,
      emailCount,
      rulesContent,
      config,
    });
  }

  return agents;
}

/** 获取某个 Agent 的收件箱邮件列表 */
export function getAgentEmails(agentName: string): Email[] {
  const agentDir = path.join(AGENTS_DIR, agentName);
  const emailDir = path.join(agentDir, 'email');

  if (!fs.existsSync(emailDir)) {
    return [];
  }

  // Load agent's auto-respond state to determine which emails the AI has processed
  let emailCheck = 0;
  try {
    const statePath = path.join(agentDir, 'chat', 'mind-state.json');
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      emailCheck = state.emailCheck || 0;
    }
  } catch {}

  const files = fs.readdirSync(emailDir).filter(f => f.endsWith('.md'));
  const emails: Email[] = [];

  for (const file of files) {
    const filePath = path.join(emailDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    let from = 'Unknown', to = agentName, subject = file.replace('.md', ''), date = '', body = content;
    try {
      const parsed = matter(content);
      from = parsed.data.from || 'Unknown';
      to = parsed.data.to || agentName;
      subject = parsed.data.subject || subject;
      date = parsed.data.date || '';
      body = (parsed.content || '').trim();
    } catch { /* gray-matter failed — manual fallback below */ }

    // If frontmatter parsing completely failed (from still Unknown), infer from context
    if (from === 'Unknown') {
      const t = content.trim().replace(/^﻿/, ''); // strip BOM
      if (t.startsWith('---')) {
        const end = t.indexOf('\n---', 3);
        const sliceEnd = end > 0 ? end : t.indexOf('---', 3);
        if (sliceEnd > 0) {
          const map: Record<string,string> = {};
          for (const line of t.slice(3, sliceEnd).split('\n')) {
            const ci = line.indexOf(':');
            if (ci > 0) {
              const key = line.slice(0, ci).trim();
              if (!map[key]) map[key] = line.slice(ci + 1).trim();
            }
          }
          from = map.from || from;
          to = map.to || to;
          subject = map.subject || subject;
          date = map.date || date;
          body = t.slice(sliceEnd + 3).trim();
        }
      }
      // Sentinel files: `sent_YYYY-MM-DD_*` → from = directory owner
      if (from === 'Unknown' && file.startsWith('sent_')) {
        from = agentName;
      }
    }

    // If date is empty or invalid, use file mtime as fallback
    if (!date) {
      try { date = fs.statSync(filePath).mtime.toISOString(); } catch {}
    }
    // Determine if AI has processed this email: file mtime <= emailCheck
    let processed = false;
    try {
      const mtimeMs = fs.statSync(filePath).mtimeMs;
      processed = mtimeMs <= emailCheck;
    } catch {}
    emails.push({ from, to, subject, date, body, filename: file, processed });
  }

  // 按文件名倒序排列（较新的邮件在前）
  emails.sort((a, b) => b.filename.localeCompare(a.filename));
  return emails;
}

/** 获取单封邮件内容 */
export function getEmail(agentName: string, filename: string): Email | null {
  const emailPath = path.join(AGENTS_DIR, agentName, 'email', filename);

  if (!fs.existsSync(emailPath)) {
    return null;
  }

  // Load agent's auto-respond state for processed status
  let emailCheck = 0;
  try {
    const statePath = path.join(AGENTS_DIR, agentName, 'chat', 'mind-state.json');
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      emailCheck = state.emailCheck || 0;
    }
  } catch {}
  let processed = false;
  try { processed = fs.statSync(emailPath).mtimeMs <= emailCheck; } catch {}

  const content = fs.readFileSync(emailPath, 'utf-8');

  try {
    const { data, content: body } = matter(content);
    return {
      from: data.from || 'Unknown',
      to: data.to || agentName,
      subject: data.subject || filename.replace('.md', ''),
      date: data.date || '',
      body: body.trim(),
      filename,
      processed,
    };
  } catch {
    return {
      from: 'Unknown',
      to: agentName,
      subject: filename.replace('.md', ''),
      date: '',
      body: content,
      filename,
      processed,
    };
  }
}

/** 获取全局统计数据 */
export function getStats(): AgentStats {
  const agents = getAgents();
  let totalEmails = 0;
  for (const agent of agents) {
    totalEmails += agent.emailCount;
  }
  return {
    totalAgents: agents.length,
    totalEmails,
  };
}
