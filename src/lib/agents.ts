import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import type { Agent, Email, AgentStats } from '@/types';

const AGENTS_DIR = path.join(process.cwd(), 'Agents');

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

    agents.push({
      name: entry.name,
      emailPath,
      emailCount,
      rulesContent,
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

  const files = fs.readdirSync(emailDir).filter(f => f.endsWith('.md'));
  const emails: Email[] = [];

  for (const file of files) {
    const filePath = path.join(emailDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    try {
      const { data, content: body } = matter(content);
      emails.push({
        from: data.from || 'Unknown',
        to: data.to || agentName,
        subject: data.subject || file.replace('.md', ''),
        date: data.date || '',
        body: body.trim(),
        filename: file,
      });
    } catch {
      // 如果没有 frontmatter，整个文件作为正文
      emails.push({
        from: 'Unknown',
        to: agentName,
        subject: file.replace('.md', ''),
        date: '',
        body: content,
        filename: file,
      });
    }
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
    };
  } catch {
    return {
      from: 'Unknown',
      to: agentName,
      subject: filename.replace('.md', ''),
      date: '',
      body: content,
      filename,
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
