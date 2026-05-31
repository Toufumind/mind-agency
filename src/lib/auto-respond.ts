import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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
  const arr = [...set].slice(-80);
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

/** Scan group chat for @agent mentions — exclude self, dedup by hash */
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
        const blocks = raw.split(/\n(?=---\nfrom:)/);
        for (const block of blocks) {
          const from = (block.match(/from:\s*(.+)/)?.[1] || '').trim();
          // Don't self-trigger on own messages
          if (from.toLowerCase() === agentName.toLowerCase()) continue;
          // Only match explicit @mention, not arbitrary name occurrence
          if (block.includes('@' + agentName)) {
            const body = (block.split('\n---\n\n')[1] || block).slice(0, 200);
            parts.push(`${g.name}群 ${from}: ${body}`);
            break;
          }
        }
      } catch {}
    }
  }
  return parts.join('\n');
}

/** Proactive check: scan recent group activity for domain-relevant discussions */
function checkGroupActivity(agentName: string): string {
  const parts: string[] = [];
  const groupsDir = path.join(process.cwd(), 'Groups');
  if (!fs.existsSync(groupsDir)) return '';

  // Domain keywords that trigger proactive engagement
  const domainKeywords: Record<string, string[]> = {
    Alice: ['前端', 'UI', 'CSS', 'dashboard', '性能', 'SSE', '页面', 'loading', '路由', '组件', 'frontend', '页面加载'],
    Bob: ['Redis', '后端', 'API', 'auth', '连接池', 'server', '性能优化', '缓存', '数据库', 'backend', 'database', 'benchmark'],
    Charlie: ['测试', 'QA', '部署', 'deploy', '审计', 'audit', '稳定性', 'stability', '监控', 'monitoring', 'CI/CD', 'test'],
    Diana: ['PM', '产品', 'Sprint', '规划', '优先级', '排期', '需求', 'planning', 'roadmap', 'milestone'],
  };

  const keywords = domainKeywords[agentName] || [];
  if (keywords.length === 0) return '';

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
        const blocks = raw.split(/\n(?=---\nfrom:)/);
        // Check if any recent block contains domain keywords AND was written by another agent
        for (const block of blocks.slice(-5)) {
          const from = (block.match(/from:\s*(.+)/)?.[1] || '').trim();
          const body = (block.split('\n---\n\n')[1] || block);
          // Don't self-trigger
          if (from.toLowerCase() === agentName.toLowerCase()) continue;
          // Check keyword relevance
          const matched = keywords.filter(kw => body.toLowerCase().includes(kw.toLowerCase()));
          if (matched.length >= 2) {
            parts.push(`${g.name}群 ${from} 讨论了 ${matched.slice(0, 3).join(', ')}: ${body.slice(0, 150)}`);
            break;
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

  // ── Email check ──
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

  // ── @Mention check ──
  let groupMentions = '';
  if (config.autoRespondToEmail) {
    groupMentions = checkGroupMentions(agentName);
  }

  // ── Dedup @mentions (prevent re-trigger on same mention in next cycle) ──
  if (groupMentions) {
    const mentionHash = crypto.createHash('md5').update(groupMentions.slice(0, 120)).digest('hex').slice(0, 8);
    const already = getProcessedCache(agentName);
    if (already.has('@' + mentionHash)) {
      return { triggered: false, reason: 'already responded to this mention' };
    }
    already.add('@' + mentionHash);
    saveProcessedCache(agentName, already);
  }

  // ── Proactive check (every ~90s, scan for domain-relevant discussions) ──
  let proactiveCtx = '';
  if (config.autoRespondToEmail && !latestEmail && !groupMentions) {
    const pcache = getProcessedCache(agentName + '_proactive');
    const lastKey = [...pcache].find(k => k.startsWith('t:')) || 't:0';
    const lastTime = parseInt(lastKey.replace('t:', '')) || 0;
    if (Date.now() - lastTime > 90000) {
      proactiveCtx = checkGroupActivity(agentName);
      // Reset proactive cache
      const fresh = new Set<string>();
      fresh.add('t:' + Date.now());
      saveProcessedCache(agentName + '_proactive', fresh);
    }
  }

  // ── Nothing to do ──
  if (!latestEmail && !groupMentions && !proactiveCtx) {
    return { triggered: false, reason: 'no triggers' };
  }

  // ── Build prompt ──
  const triggerType = proactiveCtx ? '主动扫描' : (groupMentions ? '@提及' : '新邮件');
  const prompt = `轮询触发 (${triggerType})。

${latestEmail ? `新邮件 — ${latestEmail.from}: ${latestEmail.subject}\n${latestEmail.body.slice(0, 400)}` : ''}
${groupMentions ? `群聊@你：${groupMentions}\n必须用 group_send 回复！` : ''}
${proactiveCtx ? `群聊有与你领域相关的讨论：${proactiveCtx}\n你应该用 group_send 自然地参与讨论，给出专业意见。不要等别人@你。` : ''}

规则：被@必须回复；看到相关讨论主动参与；只沟通常不写代码；用中文。`;

  try {
    const { reply } = await chatOnce(agentName, prompt);
    return { triggered: true, reply, emailFrom: latestEmail?.from || 'proactive', emailSubject: latestEmail?.subject || triggerType };
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
