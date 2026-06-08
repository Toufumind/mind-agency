import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { AGENTS_DIR } from './data-dir';

export interface SendEmailParams {
  from: string;
  to: string;
  subject: string;
  body: string;
}

/** 发送邮件：在收件人的 email/ 目录下创建 .md 文件 */
export function sendEmail(params: SendEmailParams): { success: boolean; filename: string; error?: string } {
  const { from, to, subject, body } = params;

  // 检查收件人是否存在
  const recipientDir = path.join(AGENTS_DIR, to);
  if (!fs.existsSync(recipientDir)) {
    return { success: false, filename: '', error: `收件人 "${to}" 不存在` };
  }

  const emailDir = path.join(recipientDir, 'email');
  if (!fs.existsSync(emailDir)) {
    fs.mkdirSync(emailDir, { recursive: true });
  }

  // 生成文件名
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0];
  const timeStr = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  // Keep CJK, ASCII, digits, spaces, hyphens, underscores; strip everything else (incl. U+FFFD)
  const safeSubject = subject
    .replace(/[^\w\s一-鿿-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 50);
  // Use subject if valid, otherwise fall back to timestamp (handles encoding corruption)
  const filename = safeSubject
    ? `${dateStr}_${safeSubject}.md`
    : `${dateStr}_${timeStr}_${from}_to_${to}.md`;
  const filePath = path.join(emailDir, filename);

  // 检查文件名冲突
  let finalFilename = filename;
  let counter = 1;
  while (fs.existsSync(path.join(emailDir, finalFilename))) {
    const base = filename.replace('.md', '');
    finalFilename = `${base}_${counter}.md`;
    counter++;
  }

  // 构建邮件内容
  const content = `---
from: ${from}
to: ${to}
subject: ${subject}
date: ${dateStr}
---

${body}
`;

  const { atomicWrite } = require('./atomic');
  atomicWrite(path.join(emailDir, finalFilename), content);

  // Also save sent copy to sender's email dir (so "Me" can see sent mail)
  if (from && from !== to) {
    const senderEmailDir = path.join(AGENTS_DIR, from, 'email');
    const senderDir = path.join(AGENTS_DIR, from);
    if (fs.existsSync(senderDir)) {
      if (!fs.existsSync(senderEmailDir)) fs.mkdirSync(senderEmailDir, { recursive: true });
      const sentFile = path.join(senderEmailDir, `sent_${finalFilename}`);
      atomicWrite(sentFile, content);
    }
  }

  return { success: true, filename: finalFilename };
}

/** 删除邮件 */
export function deleteEmail(agentName: string, filename: string): { success: boolean; error?: string } {
  const filePath = path.join(AGENTS_DIR, agentName, 'email', filename);

  if (!fs.existsSync(filePath)) {
    return { success: false, error: '邮件不存在' };
  }

  // 安全检查：确保路径在 Agents 目录内
  const resolved = path.resolve(filePath);
  const agentsResolved = path.resolve(AGENTS_DIR);
  if (!resolved.startsWith(agentsResolved)) {
    return { success: false, error: '路径不合法' };
  }

  fs.unlinkSync(filePath);
  return { success: true };
}
