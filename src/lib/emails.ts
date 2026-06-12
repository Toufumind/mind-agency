import { atomicWrite } from "./atomic";
import path from 'path';
import { AGENTS_DIR } from './data-dir';
import { getAgency } from './agency';

export interface SendEmailParams {
  from: string;
  to: string;
  subject: string;
  body: string;
}

/** 发送邮件：在收件人的 email/ 目录下创建 .md 文件 */
export async function sendEmail(params: SendEmailParams): Promise<{ success: boolean; filename: string; error?: string }> {
  const { from, to, subject, body } = params;

  const agency = getAgency();
  const senderProxy = agency.getAgent(from);
  const recipientProxy = agency.getAgent(to);

  // 检查收件人是否存在
  if (!recipientProxy.exists()) {
    return { success: false, filename: '', error: `收件人 "${to}" 不存在` };
  }

  // Use AgentProxy for the core send operation
  const ok = await senderProxy.sendEmail(to, subject, body);
  if (!ok) {
    return { success: false, filename: '', error: '邮件发送失败' };
  }

  // Reconstruct the filename for return value
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0];
  const timeStr = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeSubject = subject
    .replace(/[^\w\s一-鿿-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 50);
  const filename = safeSubject
    ? `${dateStr}_${safeSubject}.md`
    : `${dateStr}_${timeStr}_${from}_to_${to}.md`;

  // Also save sent copy to sender's email dir (so "Me" can see sent mail)
  if (from && from !== to) {
    const senderDir = path.join(AGENTS_DIR, from);
    const fs = require('fs');
    if (fs.existsSync(senderDir)) {
      const senderEmailDir = path.join(AGENTS_DIR, from, 'email');
      if (!fs.existsSync(senderEmailDir)) fs.mkdirSync(senderEmailDir, { recursive: true });

      // Re-read the sent file and copy it
      
      const sentFile = path.join(senderEmailDir, `sent_${filename}`);
      const content = `---\nfrom: ${from}\nto: ${to}\nsubject: ${subject}\ndate: ${dateStr}\n---\n\n${body}\n`;
      atomicWrite(sentFile, content);
    }
  }

  return { success: true, filename };
}

/** 删除邮件 */
export async function deleteEmail(agentName: string, filename: string): Promise<{ success: boolean; error?: string }> {
  const agency = getAgency();
  const proxy = agency.getAgent(agentName);
  const ok = await proxy.deleteEmail(filename);

  if (!ok) {
    return { success: false, error: '邮件不存在' };
  }

  return { success: true };
}
