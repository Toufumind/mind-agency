/**
 * Agent auto-respond — Signal-based notification protocol.
 *
 * Design:
 *   1. Check WHAT happened (counts, not content).
 *   2. Build a SIGNAL prompt — tell the Agent "you have N new things, go look".
 *   3. Agent uses MCP tools (group_read, email) to pull content itself.
 *   4. Agent decides whether to respond — system does NOT auto-post replies.
 *
 * Channels checked:
 *   - Personal email:  Agents/<name>/email/
 *   - Group email:     Groups/<name>/Agents/<name>/email/
 *   - Group chat:      Groups/<name>/chat/    (new messages since lastCheck)
 *   - @mentions:       Group chat messages containing @AgentName
 *
 * Real-time: fs.watch (new files) + 30s polling fallback (content append).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { chatOnce, getAgentConfig } from './chat';
import { AGENTS_DIR, GROUPS_DIR, MIND_DIR } from './data-dir';
import { loadState, saveState, ensureGroup, getAgentGroups, invalidateGroupsCache, type AgentState } from './state';
import { setActivity, clearActivity } from './agent-activity';
import { agentCache } from './cache';

// ── Signal debounce: per-agent last-spawn time ─────────

const lastSpawn = new Map<string, number>();
const DEBOUNCE_URGENT = 5_000;
const DEBOUNCE_IDLE   = 15_000;
const sleepMs = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── v0.4: Request Queue — prevent duplicate spawns per agent ─────────

const agentQueues = new Map<string, Promise<void>>();

/** Queue a task for an agent — runs one at a time per agent, no duplicates */
async function enqueueAgent<T>(agent: string, task: () => Promise<T>): Promise<T> {
  const prev = agentQueues.get(agent) || Promise.resolve();
  let result!: T;
  const wrapped = async () => { result = await task(); };
  const next = prev.then(wrapped, wrapped);
  agentQueues.set(agent, next.then(() => {}, () => {}).finally(() => {
    if (agentQueues.get(agent) === next) agentQueues.delete(agent);
  }));
  await next;
  return result;
}

// ── Types ────────────────────────────────────────────────

interface EmailInfo { from: string; subject: string; filename: string; mtime: number; }

interface Signal {
  personalEmails: number;
  groupEmails: Record<string, number>;
  newMessages: Record<string, number>;
  mentions: { group: string; from: string; snippet: string }[];
  invitations?: { group: string; invitedBy: string }[];
  urgent: boolean;
  priority: 'critical' | 'normal' | 'low';
}

interface AgentConfig {
  autoRespondToEmail: boolean;
  autoProcessGroupInvites: boolean;
  notifyOnEmail: boolean;
  notifyOnGroupMention: boolean;
}

// ── Config ───────────────────────────────────────────────

// Use cached getAgentConfig from chat.ts instead of reading config.json directly
function getConfig(agentName: string): AgentConfig {
  const config = getAgentConfig(agentName);
  return {
    autoRespondToEmail: (config as any).autoRespondToEmail ?? false,
    autoProcessGroupInvites: (config as any).autoProcessGroupInvites ?? false,
    notifyOnEmail: (config as any).notifyOnEmail ?? true,
    notifyOnGroupMention: (config as any).notifyOnGroupMention ?? true,
  };
}

// ── Email scanning ──────────────────────────────────────

/** Scan a single email directory, return files newer than `since` (ms timestamp). */
function scanEmailDir(dir: string, since: number): EmailInfo[] {
  if (!fs.existsSync(dir)) return [];
  const results: EmailInfo[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const fp = path.join(dir, f);
    const st = fs.statSync(fp);
    if (st.mtimeMs <= since) continue;
    // Only read content if mtime passes (avoids unnecessary I/O)
    const raw = fs.readFileSync(fp, 'utf-8');
    const fm = raw.match(/^---\nfrom:\s*(.+?)\nto:\s*(.+?)\nsubject:\s*(.+?)\n/);
    if (!fm) continue;
    results.push({ from: fm[1].trim(), subject: fm[3].trim(), filename: f, mtime: st.mtimeMs });
  }
  return results;
}

// ── Group chat scanning ─────────────────────────────────

/** Parse a chat .md file into individual message blocks. */
function parseChatMessages(filePath: string): { from: string; date: string; body: string; offset: number }[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const msgs: { from: string; date: string; body: string; offset: number }[] = [];
    // Split on "---\nfrom:" (YAML frontmatter start of each message)
    const blocks = raw.split(/\n(?=---\nfrom:)/);
    for (const block of blocks) {
      const m = block.match(/^---\nfrom:\s*(.+?)\ndate:\s*(.+?)\n---\n\n([\s\S]*)/);
      if (m) {
        msgs.push({ from: m[1].trim(), date: m[2].trim(), body: m[3].trim(), offset: raw.indexOf(block) });
      }
    }
    return msgs;
  } catch { return []; }
}

// ── Signal builder ──────────────────────────────────────

/**
 * Scan all channels for an agent and build a signal.
 *
 * Returns null if nothing new.
 */
function buildSignal(agent: string): { signal: Signal; state: AgentState; dirty: boolean } | null {
  const state = loadState(agent);
  let dirty = false;
  const now = Date.now();

  const signal: Signal = {
    personalEmails: 0,
    groupEmails: {},
    newMessages: {},
    mentions: [],
    urgent: false,
    priority: 'normal',
  };

  // ── 0. Pending invitations ──────────────────────────
  if (fs.existsSync(GROUPS_DIR)) {
    for (const g of fs.readdirSync(GROUPS_DIR, { withFileTypes: true })) {
      if (!g.isDirectory() || g.name.startsWith('.')) continue;
      const invDir = path.join(GROUPS_DIR, g.name, '.invitations');
      if (!fs.existsSync(invDir)) continue;
      const invFile = path.join(invDir, `${agent.toLowerCase()}.json`);
      if (fs.existsSync(invFile)) {
        try {
          const inv = JSON.parse(fs.readFileSync(invFile, 'utf-8'));
          signal.mentions.push({
            group: g.name,
            from: inv.invitedBy || 'unknown',
            snippet: `邀请你加入 ${g.name} 群组`,
          });
          signal.invitations = signal.invitations || [];
          signal.invitations.push({ group: g.name, invitedBy: inv.invitedBy || 'unknown' });
          signal.urgent = true;
          dirty = true;
        } catch {}
      }
    }
  }

  // ── 1. Personal email ─────────────────────────────
  const persDir = path.join(AGENTS_DIR, agent, 'email');
  const newPersEmails = scanEmailDir(persDir, state.emailCheck);
  if (newPersEmails.length > 0) {
    signal.personalEmails = newPersEmails.length;
    state.emailCheck = now;
    dirty = true;
  }

  // ── 2. Group channels ────────────────────────────
  const currentGroups = getAgentGroups(agent);

  for (const g of currentGroups) {
    const gs = ensureGroup(state, g);

    // 2a. Group email
    const gEmailDir = path.join(GROUPS_DIR, g, 'Agents', agent, 'email');
    const newGEmails = scanEmailDir(gEmailDir, gs.emailCheck);
    if (newGEmails.length > 0) {
      signal.groupEmails[g] = newGEmails.length;
      gs.emailCheck = now;
      dirty = true;
    }

    // 2b. Group chat — new messages since lastCheck
    const chatDir = path.join(GROUPS_DIR, g, 'chat');
    if (fs.existsSync(chatDir)) {
      let newCount = 0;
      const chatFiles = fs.readdirSync(chatDir)
        .filter(f => f.endsWith('.md'))
        .sort();

      for (const cf of chatFiles) {
        const fp = path.join(chatDir, cf);
        try {
          const st = fs.statSync(fp);
          // File modified since last check → may contain new messages
          if (st.mtimeMs <= gs.chatCheck) continue;
        } catch { continue; }

        for (const msg of parseChatMessages(fp)) {
          const msgTs = new Date(msg.date).getTime();
          if (msgTs <= gs.chatCheck) continue;
          if (msg.from.toLowerCase() === agent.toLowerCase()) continue;
          newCount++;

          // Check for @mention
          if (msg.body.toLowerCase().includes('@' + agent.toLowerCase())) {
            // Generate hash for dedup
            const hash = crypto.createHash('md5').update(g + msg.from + msg.body.slice(0, 100)).digest('hex').slice(0, 12);
            if (gs.lastMention !== hash) {
              signal.mentions.push({
                group: g,
                from: msg.from,
                snippet: msg.body.slice(0, 100),
              });
              gs.lastMention = hash;
              gs.chatCheck = now;     // advance only on actual @mention (agent will be spawned)
              signal.urgent = true;
              dirty = true;
            }
          }
        }
      }

      if (newCount > 0) {
        signal.newMessages[g] = newCount;
        // Advance chatCheck even if no @mention — prevents re-scanning same files.
        // The agent won't be spawned, but we won't re-detect these messages next tick.
        gs.chatCheck = now;
        dirty = true;
      }
    }
  }

  // ── 3. Clean up stale groups from state ────────────
  for (const g of Object.keys(state.groups)) {
    if (!currentGroups.includes(g)) delete state.groups[g];
  }

  // ── 2c. Workflow notifications ─────────────────────
  const notifDir = path.join(MIND_DIR, 'agents', agent, '.workflow-notifications');
  if (fs.existsSync(notifDir)) {
    const notifFiles = fs.readdirSync(notifDir).filter(f => f.endsWith('.json'));
    for (const f of notifFiles) {
      try {
        const notif = JSON.parse(fs.readFileSync(path.join(notifDir, f), 'utf-8'));
        signal.mentions.push({
          group: 'workflow',
          from: 'workflow-engine',
          snippet: `[工作流任务] runId=${notif.runId} stepId=${notif.stepId}\n${notif.prompt || ''}`,
        });
        signal.urgent = true;
        dirty = true;
      } catch {}
    }
  }

  // ── 3. Nothing new? ───────────────────────────────
  const totalNew =
    signal.personalEmails +
    Object.values(signal.groupEmails).reduce((a, b) => a + b, 0) +
    Object.values(signal.newMessages).reduce((a, b) => a + b, 0) +
    signal.mentions.length;

  if (totalNew === 0) return null;

  // DON'T save state here — emailCheck will advance only after the agent
  // successfully processes the email. If the software is closed before
  // autoRespond completes, the email stays "unseen" and gets re-detected
  // on next startup (mtime > old emailCheck).
  return { signal, state, dirty };
}

// ── Signal → Prompt ─────────────────────────────────────

function signalToPrompt(agent: string, sig: Signal, groupName?: string): string {
  const lines: string[] = [];

  lines.push('[系统通知]');
  lines.push('');

  // Emails
  const emailParts: string[] = [];
  if (sig.personalEmails > 0) emailParts.push(`个人邮箱 ${sig.personalEmails} 封新邮件`);
  for (const [g, n] of Object.entries(sig.groupEmails)) {
    if (n > 0) emailParts.push(`${g} 群邮箱 ${n} 封`);
  }
  if (emailParts.length > 0) lines.push(`📧 ${emailParts.join(' | ')}`);

  // Group chat
  const chatParts: string[] = [];
  for (const [g, n] of Object.entries(sig.newMessages)) {
    if (n > 0) chatParts.push(`${g} 群 ${n} 条`);
  }
  if (chatParts.length > 0) lines.push(`💬 群聊新消息: ${chatParts.join(' | ')}`);

  // Invitations
  if (sig.invitations && sig.invitations.length > 0) {
    lines.push('📨 群组邀请 (用 decide 接受/拒绝):');
    for (const inv of sig.invitations) {
      lines.push(`   ${inv.invitedBy} 邀请你加入 ${inv.group} 群组`);
    }
    lines.push('   接受: decide(group, decision="APPROVED", reason="接受邀请")');
    lines.push('   拒绝: decide(group, decision="REJECTED", reason="拒绝邀请")');
  }

  // @mentions
  if (sig.mentions.length > 0) {
    lines.push(`@提及:`);
    for (const m of sig.mentions) {
      lines.push(`  ${m.from} 在 ${m.group} 群 @了你`);
    }
  }

  lines.push('');
  lines.push('步骤:');
  lines.push('1. group_read 查看上下文 → 检查邮箱');
  lines.push('2. 如果是需要你投票/审批 → decide(group, decision, reason) 结构化回复');
  lines.push('3. 如果是普通讨论 → group_send 回复');
  lines.push('4. 重要信息记到 agent_memory(action="write")');
  lines.push('5. 如果是工作流任务（包含 runId= 和 stepId=）→ 完成任务后调用 workflow_callback(runId, stepId, status, summary) 报告结果');
  lines.push('自主决定是否回复。中文。');

  return lines.join('\n');
}

// ── Main entry ──────────────────────────────────────────

export async function autoRespond(
  agent: string,
  options?: { groupName?: string; force?: boolean }
): Promise<{
  triggered: boolean; reply?: string; reason?: string;
}> {
  const config = getConfig(agent);
  if (!config.autoRespondToEmail && !options?.force) {
    return { triggered: false, reason: 'autoRespond disabled' };
  }

  // Invalidate stale caches — new agent may have joined since last scan
  // First get current groups (before invalidation), then invalidate all related caches
  const agentGroups = getAgentGroups(agent);
  for (const g of agentGroups) {
    agentCache.invalidate('groupChat', g);
  }
  invalidateGroupsCache(agent);

  // v0.5: Move buildSignal inside enqueueAgent to prevent race condition
  // where two concurrent calls read the same state and overwrite each other
  return enqueueAgent(agent, async () => {
    // Build signal (reads state — now serialized per agent)
    const result = buildSignal(agent);

    // Nothing to do
    if (!result) {
      return { triggered: false, reason: 'no new signals' };
    }

    const { signal, state, dirty } = result;

  // Only spawn claude for: @mention, new email, or forced.
  // v0.4: Determine priority based on signal content
  if (signal.urgent || (signal.invitations && signal.invitations.length > 0)) {
    signal.priority = 'critical';
  } else if (signal.mentions.length > 0 || signal.personalEmails > 0) {
    signal.priority = 'normal';
  } else {
    signal.priority = 'low';
  }

  // Chat-only messages → advance chatCheck (not emailCheck)
  if (!signal.urgent && signal.personalEmails === 0 &&
      Object.values(signal.groupEmails).every(n => n === 0) &&
      !options?.force) {
    // chatCheck was already advanced in buildSignal — persist that
    saveState(agent, state);
    return { triggered: false, reason: 'chat-only, state updated' };
  }

  // ── Debounce — prevent duplicate spawns from watcher+poll overlap ──
  // v0.4: Priority-based debounce — critical bypasses, low has longer window
  const now = Date.now();
  const last = lastSpawn.get(agent) || 0;
  const window = signal.priority === 'critical' ? 5_000 : signal.priority === 'low' ? 120_000 : DEBOUNCE_IDLE;
  if (!options?.force && now - last < window) {
    // Save state to advance chatCheck (prevent re-scanning) but don't advance emailCheck
    // so the agent will process emails on next allowed spawn
    saveState(agent, state);
    return { triggered: false, reason: `debounced (${now - last}ms < ${window}ms)` };
  }
  lastSpawn.set(agent, now);

  // Build prompt and call agent with retry
  const prompt = signalToPrompt(agent, signal, options?.groupName);

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      setActivity(agent, 'processing', signal.urgent ? '处理通知' : '检查更新');
      const { reply } = await chatOnce(agent, prompt, options?.groupName);
      clearActivity(agent);
      saveState(agent, state);
      return { triggered: true, reply };
    } catch (e: any) {
      const isLast = attempt === maxRetries - 1;
      if (isLast) {
        return { triggered: false, reason: `all ${maxRetries} attempts failed: ${e.message}` };
      }
      const delay = Math.pow(2, attempt + 1) * 1000;
      console.log(`[autoRespond] ${agent} chatOnce failed (attempt ${attempt + 1}/${maxRetries}): ${e.message}. Retrying in ${delay}ms...`);
      await sleepMs(delay);
    }
  }
  return { triggered: false, reason: 'unreachable' };
  }); // end enqueueAgent
}

// ── Heartbeat ────────────────────────────────────────────
// Periodic wake-up. Enabling autoRespondToEmail fires heartbeat every N seconds.
// No signal scanning, no task injection — just a gentle "you've been woken" nudge.

const lastHeartbeat = new Map<string, number>();

export async function agentHeartbeat(agent: string, intervalMs: number): Promise<{ triggered: boolean; reply?: string; reason?: string }> {
  const config = getConfig(agent);
  if (!config.autoRespondToEmail) return { triggered: false, reason: 'autoRespond disabled' };

  const now = Date.now();
  const last = lastHeartbeat.get(agent) || 0;
  if (now - last < intervalMs) {
    return { triggered: false, reason: `throttled (${now - last}ms < ${intervalMs}ms)` };
  }
  lastHeartbeat.set(agent, now);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      setActivity(agent, 'processing', '心跳检查');
      const { reply } = await chatOnce(agent, '[Heartbeat] 你被唤醒了。请自主检查是否有需要处理的事项。如果有，在群里同步进展。如果没有，忽略这条消息即可。用中文。');
      clearActivity(agent);
      return { triggered: true, reply };
    } catch (e: any) {
      if (attempt === 2) return { triggered: false, reason: `all 3 attempts failed: ${e.message}` };
      await sleepMs(Math.pow(2, attempt + 1) * 1000);
    }
  }
  return { triggered: false, reason: 'unreachable' };
}

// ── Batch poll ──────────────────────────────────────────

export async function pollAllAgents(groupName?: string): Promise<{ agent: string; triggered: boolean; reason?: string }[]> {
  if (!fs.existsSync(AGENTS_DIR)) return [];

  const agents = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name);

  return Promise.all(
    agents.map(async (a) => {
      try {
        const result = await autoRespond(a, { groupName });
        return { agent: a, triggered: result.triggered, reason: result.reason };
      } catch {
        return { agent: a, triggered: false, reason: 'error' };
      }
    })
  );
}

// ── Targeted single-agent poll (v0.4: MCP direct notify) ──

/** Poll a single agent — 10x faster than pollAllAgents when you know which agent changed */
export async function pollAgent(agent: string, groupName?: string): Promise<{ agent: string; triggered: boolean; reason?: string }> {
  try {
    const result = await autoRespond(agent, { groupName });
    return { agent, triggered: result.triggered, reason: result.reason };
  } catch {
    return { agent, triggered: false, reason: 'error' };
  }
}
