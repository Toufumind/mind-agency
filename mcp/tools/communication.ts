/**
 * MCP Server — Communication tools
 *
 * Tools: group_send, group_read, email_send
 */

import fs from 'fs';
import path from 'path';
import { groupsDir, exists, readDir, readGroupChat, appendToChat, triggerPoll, emitBusEvent, writeAudit, broadcast, PROJECT_ROOT, AGENTS_DIR } from './shared';

export interface ToolDef { name: string; description: string; inputSchema: any; }

export function communicationTools(): ToolDef[] {
  return [
    { name: 'group_send', description: '向群组发送消息。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, message: { type: 'string' } }, required: ['group', 'message'] } },
    { name: 'group_read', description: '读取群组最近的聊天记录。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, limit: { type: 'number' } }, required: ['group'] } },
    { name: 'email_send', description: '向其他 Agent 发送邮件。', inputSchema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject'] } },
  ];
}

export async function handleCommunicationTool(
  name: string, args: any, agentName: string,
  respond: (id: string, msg: any) => void, id: string
): Promise<boolean> {
  const a = args;

  if (name === 'group_send') {
    const { group, message } = a;
    if (!group || !message) { respond(id, { content: [{ type: 'text', text: 'group and message required' }], isError: true }); return true; }
    const gDir = path.join(groupsDir(), group);
    if (!exists(gDir)) { respond(id, { content: [{ type: 'text', text: `Group "${group}" not found` }], isError: true }); return true; }
    const agDir = path.join(gDir, 'Agents', agentName);
    if (!exists(agDir)) { respond(id, { content: [{ type: 'text', text: `You are not a member of ${group}. Use group_join first.` }], isError: true }); return true; }
    appendToChat(group, agentName, message);
    broadcast({ type: 'group_message', group, from: agentName, message });
    triggerPoll(agentName, group);
    writeAudit({ agent: agentName, action: 'group.send', resource: `group:${group}`, details: message.slice(0, 200) });
    emitBusEvent('message.sent', { group, from: agentName, body: message.slice(0, 200) });
    // Check for @mentions
    const mentionRe = /@([A-Za-z0-9_-]+)/g;
    let m;
    while ((m = mentionRe.exec(message)) !== null) {
      const mentioned = m[1];
      if (mentioned.toLowerCase() !== agentName.toLowerCase()) {
        emitBusEvent('message.mention', { group, from: agentName, target: mentioned, snippet: message.slice(0, 100) });
      }
    }
    respond(id, { content: [{ type: 'text', text: `消息已发送到 ${group}` }] });
    return true;
  }

  if (name === 'group_read') {
    const { group, limit } = a;
    if (!group) { respond(id, { content: [{ type: 'text', text: 'group required' }], isError: true }); return true; }
    const gDir = path.join(groupsDir(), group);
    if (!exists(gDir)) { respond(id, { content: [{ type: 'text', text: `Group "${group}" not found` }], isError: true }); return true; }
    const agDir = path.join(gDir, 'Agents', agentName);
    if (!exists(agDir)) { respond(id, { content: [{ type: 'text', text: `You are not a member of ${group}. Use group_join first.` }], isError: true }); return true; }
    const msgs = readGroupChat(group, limit || 20);
    if (msgs.length === 0) { respond(id, { content: [{ type: 'text', text: '暂无消息' }] }); return true; }
    const text = msgs.map(m => `[${m.from}] ${m.body}`).join('\n\n');
    respond(id, { content: [{ type: 'text', text }] });
    return true;
  }

  if (name === 'email_send') {
    const { to, subject, body: emailBody } = a;
    if (!to || !subject) { respond(id, { content: [{ type: 'text', text: 'to and subject required' }], isError: true }); return true; }
    const recipientDir = path.join(PROJECT_ROOT, 'Agents', to);
    if (!exists(recipientDir)) { respond(id, { content: [{ type: 'text', text: `Agent "${to}" not found` }], isError: true }); return true; }
    const resolved = path.resolve(path.join(PROJECT_ROOT, 'Agents', to));
    if (!resolved.startsWith(path.resolve(AGENTS_DIR))) {
      respond(id, { content: [{ type: 'text', text: 'Invalid recipient name — path traversal not allowed' }], isError: true });
      return true;
    }
    const emailDir = path.join(recipientDir, 'email');
    if (!exists(emailDir)) fs.mkdirSync(emailDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeSubject = subject.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
    const filename = `${ts}_${safeSubject}.md`;
    const content = `---\nfrom: ${agentName}\nto: ${to}\nsubject: ${subject}\ndate: ${new Date().toISOString()}\n---\n\n${emailBody || ''}\n`;
    fs.writeFileSync(path.join(emailDir, filename), content, 'utf-8');
    // Save sent copy
    const senderEmailDir = path.join(PROJECT_ROOT, 'Agents', agentName, 'email');
    if (exists(senderEmailDir)) {
      fs.writeFileSync(path.join(senderEmailDir, `sent_${filename}`), content, 'utf-8');
    }
    writeAudit({ agent: agentName, action: 'email.send', resource: `agent:${to}`, details: subject.slice(0, 100) });
    triggerPoll(to);
    respond(id, { content: [{ type: 'text', text: `邮件已发送给 ${to}: ${subject}` }] });
    return true;
  }

  return false;
}
