/**
 * Unified Consensus Engine v2 — deliberation + adversarial verify + behavior profiles.
 *
 * Every impactful cross-agent action: request → resolve → collect → execute/reject.
 *
 * New in v2:
 *   - logic: 'and' | 'or' | 'threshold' + threshold field
 *   - adversary: optional second-agent review after first approval
 *   - Behavior profile fields in agent config.json
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { GROUPS_DIR, MIND_DIR, AGENTS_DIR } from './data-dir';
import { loadGroupConfig } from './group-config';

// ── Types ───────────────────────────────────────────────

export type ApproverType = 'agent' | 'role' | 'group_owner' | 'group_admin' | 'human' | 'step_agent';
export type ConsensusLogic = 'and' | 'or' | 'threshold';

export interface Approver { type: ApproverType; name?: string; role?: string; }

export interface ConsensusRule {
  action: string;
  description?: string;
  approvers: Approver[];
  quorum: number;
  /** How to tally votes. Default: 'and' (everyone must approve). 'or' = any one approves. 'threshold' = N of total. */
  logic?: ConsensusLogic;
  /** Only for logic='threshold': how many approvals needed out of total approvers */
  threshold?: number;
  /** Adversarial review: after first agent approves, a second agent must verify */
  adversary?: Approver;
  /** v0.4: Config permission key — if agent has this permission, auto-pass without approval */
  permissionKey?: string;
}

export interface ConsensusRequest {
  id: string;
  action: string;
  group: string;
  requestedBy: string;
  description: string;
  createdAt: number;
  timeoutMs: number;
  approvers: string[];
  decisions: Record<string, string>;
  /** Target agent for actions like group_kick, group_invite, group_set_admin */
  target?: string;
  status: 'pending' | 'approved' | 'rejected' | 'adversary_review' | 'rebuttal';
  callback?: string;
  /** Adversarial verification: second opinion required */
  adversary?: string;
  adversaryDecision?: string;    // APPROVED | REJECTED
  adversaryReason?: string;
  /** v0.4: Multi-round adversarial — current round (max 3) */
  adversaryRound?: number;
  /** v0.4: Rebuttal from original approver */
  rebuttal?: string;
}

// ── Default rules ────────────────────────────────────────

const DEFAULT_RULES: ConsensusRule[] = [
  // AND logic — everyone must agree
  { action: 'group_delete', description: '删除群组需要群主批准', approvers: [{ type: 'group_owner' }], quorum: 1, logic: 'and', permissionKey: 'canDeleteGroup' },
  { action: 'group_set_admin', description: '设置管理员需要群主批准', approvers: [{ type: 'group_owner' }], quorum: 1, logic: 'and' },
  { action: 'group_set_role', description: '设置角色需要群主批准', approvers: [{ type: 'group_owner' }], quorum: 1, logic: 'and' },

  // OR logic — any one qualified person approves
  { action: 'deploy', description: '部署需要任意 admin 批准，并由另一人复核', approvers: [{ type: 'role', role: 'admin' }, { type: 'role', role: 'PM' }], quorum: 1, logic: 'or', adversary: { type: 'role', role: 'admin' } },
  { action: 'agent_create', description: '创建 Agent 需要任意 admin 批准', approvers: [{ type: 'role', role: 'admin' }], quorum: 1, logic: 'or' },
  { action: 'config_change', description: '修改 Agent 配置需要任意 admin 批准', approvers: [{ type: 'role', role: 'admin' }], quorum: 1, logic: 'or' },
  { action: 'group_create', description: '创建群组', approvers: [{ type: 'human' }], quorum: 1, logic: 'and', permissionKey: 'canCreateGroup' },
  { action: 'group_invite', description: '邀请成员加入群组', approvers: [{ type: 'group_admin' }], quorum: 1, logic: 'or' },
  { action: 'group_set_info', description: '修改群组信息', approvers: [{ type: 'group_admin' }], quorum: 1, logic: 'or' },
  { action: 'group_announce', description: '发布群组公告', approvers: [{ type: 'group_admin' }], quorum: 1, logic: 'or' },

  // Threshold logic — 2 of 3
  { action: 'critical_deploy', description: '关键部署需要至少 2 个 admin 批准', approvers: [{ type: 'role', role: 'admin' }, { type: 'role', role: 'PM' }], quorum: 2, logic: 'threshold', threshold: 2, adversary: { type: 'agent', name: 'Charlie' } },

  // Step agent — workflow step, single agent approval + adversary uses admin to ensure different reviewer
  { action: 'workflow_step', description: 'Workflow 步骤由指定 Agent 执行，另一人复核', approvers: [{ type: 'step_agent' }], quorum: 1, logic: 'and', adversary: { type: 'role', role: 'admin' } },
  { action: 'workflow_trigger', description: '触发 Workflow', approvers: [], quorum: 0 }, // no approval needed — user triggers directly
  { action: 'workflow_create', description: '创建工作流', approvers: [{ type: 'human' }], quorum: 1, logic: 'and' },
  { action: 'workflow_step_deploy', description: '部署工作流步骤', approvers: [{ type: 'human' }], quorum: 1, logic: 'and', permissionKey: 'canDeploy' },

  // Admin-level — one is enough
  { action: 'group_kick', description: '踢出成员需要管理员批准', approvers: [{ type: 'group_admin' }], quorum: 1, logic: 'or' },
];

// ── Load rules ───────────────────────────────────────────

function loadRules(group?: string): ConsensusRule[] {
  if (group) {
    const jsonFile = path.join(GROUPS_DIR, group, 'consensus.json');
    try { if (fs.existsSync(jsonFile)) { const c = JSON.parse(fs.readFileSync(jsonFile, 'utf-8')); if (Array.isArray(c)) return c; } } catch {}
  }
  const systemFile = path.join(MIND_DIR, 'consensus.json');
  try { if (fs.existsSync(systemFile)) { const c = JSON.parse(fs.readFileSync(systemFile, 'utf-8')); if (Array.isArray(c)) return c; } } catch {}
  return DEFAULT_RULES;
}

export function getRule(action: string, group?: string): ConsensusRule | null {
  return loadRules(group).find(r => r.action === action) || null;
}

/** v0.4: Create consensus request with explicit approvers (used by permission-engine) */
export function createRequest(opts: {
  action: string; group: string; requestedBy: string;
  description: string; approvers: string[]; adversary?: string; target?: string;
}): string {
  const id = randomUUID().slice(0, 8);
  const group = opts.group || '_global';
  const dir = requestsDir(group);

  const request: ConsensusRequest = {
    id, action: opts.action, group, requestedBy: opts.requestedBy,
    description: opts.description, createdAt: Date.now(),
    timeoutMs: 86400_000, // 24 hours
    approvers: opts.approvers, decisions: {}, status: 'pending',
    adversary: opts.adversary, target: opts.target,
  };

  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(request, null, 2));
  return id;
}

// ── Resolve approvers ────────────────────────────────────

export function resolveApprovers(rule: ConsensusRule, group: string, stepAgent?: string): string[] {
  const approvers = new Set<string>();
  const gc = loadGroupConfig(group);

  for (const a of rule.approvers) {
    switch (a.type) {
      case 'agent': if (a.name) approvers.add(a.name); break;
      case 'step_agent': if (stepAgent) approvers.add(stepAgent); break;
      case 'human': approvers.add('human'); break;
      case 'group_owner': if (gc?.owner) approvers.add(gc.owner); break;
      case 'group_admin': if (gc) { if (gc.owner) approvers.add(gc.owner); for (const admin of gc.admins) approvers.add(admin); } break;
      case 'role': {
        if (fs.existsSync(AGENTS_DIR)) for (const d of fs.readdirSync(AGENTS_DIR, { withFileTypes: true })) { if (!d.isDirectory() || d.name.startsWith('.')) continue; try { const cfg = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, d.name, 'config.json'), 'utf-8')); if (cfg.roles?.includes(a.role!)) approvers.add(d.name); } catch {} }
        break;
      }
    }
  }
  return [...approvers];
}

function resolveSingleApprover(a: Approver, group: string, stepAgent?: string): string | null {
  const list = resolveApprovers({ action: '', approvers: [a], quorum: 1 }, group, stepAgent);
  return list.length > 0 ? list[0] : null;
}

// ── Request management ────────────────────────────────────

function requestsDir(group: string): string {
  const d = path.join(GROUPS_DIR, group, '.consensus');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

export function createConsensusRequest(
  action: string, group: string, requestedBy: string,
  description: string, timeoutMs = 0, stepAgent?: string, callbackData?: string,
): ConsensusRequest | { error: string } {
  const rule = getRule(action, group);
  if (!rule) return { error: `no consensus rule defined for action: ${action}` };

  const approvers = resolveApprovers(rule, group, stepAgent);
  if (approvers.length === 0) return { error: `no approvers found for action: ${action}` };

  // Resolve adversary
  let adversary: string | undefined;
  if (rule.adversary) {
    const adv = resolveSingleApprover(rule.adversary, group, stepAgent);
    if (adv && adv !== requestedBy && !approvers.includes(adv)) adversary = adv;
    else if (approvers.length > 1) adversary = approvers.find(a => a !== requestedBy);
    else adversary = undefined; // no one else to verify
  }

  const id = randomUUID().slice(0, 8);
  const logic = rule.logic || 'and';
  const threshold = rule.threshold || rule.quorum;

  const request: ConsensusRequest = {
    id, action, group, requestedBy, description,
    createdAt: Date.now(), timeoutMs, approvers,
    decisions: {}, status: 'pending', callback: callbackData, adversary,
  };

  const f = path.join(requestsDir(group), `${id}.json`);
  const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(request, null, 2), 'utf-8'); fs.renameSync(tmp, f);

  console.log(`[consensus] ${id}: ${action} by ${requestedBy} → needs ${approvers.join(',')} [logic=${logic}]${adversary ? ' + adversary=' + adversary : ''}`);

  // Post to chat
  const chatDir = path.join(GROUPS_DIR, group, 'chat');
  if (!fs.existsSync(chatDir)) fs.mkdirSync(chatDir, { recursive: true });
  const mentions = approvers.map(a => a === 'human' ? '@me' : `@${a}`).join(' ');
  let logicHint = '';
  if (logic === 'or') logicHint = `（任意一人批准即可，quorum=${rule.quorum}）`;
  else if (logic === 'threshold') logicHint = `（需要至少 ${threshold} 人批准）`;
  else logicHint = `（需要所有人批准，quorum=${rule.quorum}）`;
  const msgText = `[consensus #${id}] ${mentions} — ${description}\n请用 decide(group="${group}", decision="APPROVED|REJECTED", requestId="${id}") 回复。${logicHint}`;
  const ts = Date.now();
  const chatFile = path.join(chatDir, `${ts}_system_consensus.md`);
  const chatContent = `---\nfrom: system\ndate: ${new Date().toISOString()}\n---\n\n${msgText}\n`;
  const chatTmp = chatFile + '.tmp'; fs.writeFileSync(chatTmp, chatContent, 'utf-8'); fs.renameSync(chatTmp, chatFile);

  if (request.timeoutMs > 0) {
    setTimeout(() => { const cur = getRequest(group, id); if (cur && cur.status === 'pending') { cur.status = 'rejected'; saveRequest(group, cur); console.log(`[consensus] ${id}: timed out`); } }, request.timeoutMs);
  }

  return request;
}

export function getRequest(group: string, id: string): ConsensusRequest | null {
  const f = path.join(requestsDir(group), `${id}.json`);
  try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch {}
  return null;
}

export function saveRequest(group: string, req: ConsensusRequest): void {
  const f = path.join(requestsDir(group), `${req.id}.json`);
  const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(req, null, 2), 'utf-8'); fs.renameSync(tmp, f);
}

export function listPendingRequests(group: string): ConsensusRequest[] {
  const d = requestsDir(group); if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => { try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf-8')); } catch { return null; } }).filter(Boolean);
}

// ── Decision processing (v2: logic modes + adversary) ────

export interface DecisionResult { status: string; request?: ConsensusRequest; phase?: string; }

export function submitDecision(group: string, requestId: string, approver: string, decision: 'APPROVED' | 'REJECTED'): DecisionResult {
  const req = getRequest(group, requestId);
  if (!req) return { status: 'not_found' };
  if (req.status === 'approved' || req.status === 'rejected') return { status: 'already_decided', request: req };

  // v0.4: Multi-round adversary review phase
  if (req.status === 'adversary_review') {
    if (!req.adversary || approver.toLowerCase() !== req.adversary.toLowerCase()) return { status: 'not_an_approver' };
    req.adversaryDecision = decision;
    req.adversaryReason = (decision === 'APPROVED') ? '' : 'adversary reject';
    const round = (req.adversaryRound || 1) + 1;

    if (decision === 'APPROVED') {
      // Adversary confirmed → approved
      req.status = 'approved';
      saveRequest(group, req);
      console.log(`[consensus] ${req.id}: adversary ${approver} confirmed (round ${round}) → APPROVED`);
      postResult(group, req, 'approved');
      return { status: 'approved', request: req, phase: 'adversary_confirmed' };
    }

    // Adversary rejected → allow rebuttal if under 3 rounds
    if (round < 3) {
      req.status = 'rebuttal';
      req.adversaryRound = round;
      saveRequest(group, req);
      console.log(`[consensus] ${req.id}: adversary ${approver} rejected (round ${round}) → awaiting rebuttal`);

      // Post rebuttal request to chat
      const chatDir = path.join(GROUPS_DIR, group, 'chat');
      if (!fs.existsSync(chatDir)) fs.mkdirSync(chatDir, { recursive: true });
      const msg = `[consensus #${req.id}] ⚠️ 复核未通过（第${round}轮） — @${req.requestedBy} 可以反驳。用 decide(group="${group}", decision="APPROVED|REJECTED", requestId="${req.id}") 回复。`;
      const ts2 = Date.now();
      const cf = path.join(chatDir, `${ts2}_system_rebuttal.md`);
      const cc = `---\nfrom: system\ndate: ${new Date().toISOString()}\n---\n\n${msg}\n`;
      const tmp = cf + '.tmp'; fs.writeFileSync(tmp, cc, 'utf-8'); fs.renameSync(tmp, cf);

      return { status: 'rebuttal', request: req, phase: 'awaiting_rebuttal' };
    }

    // Max rounds reached → final reject
    req.status = 'rejected';
    saveRequest(group, req);
    console.log(`[consensus] ${req.id}: adversary ${approver} rejected (max rounds) → REJECTED`);
    postResult(group, req, 'rejected');
    return { status: 'rejected', request: req, phase: 'adversary_rejected' };
  }

  // v0.4: Rebuttal phase — original approver can respond
  if (req.status === 'rebuttal') {
    if (approver.toLowerCase() !== req.requestedBy.toLowerCase()) return { status: 'not_an_approver' };
    req.rebuttal = decision;

    if (decision === 'APPROVED') {
      // Rebuttal approved → back to adversary review
      req.status = 'adversary_review';
      req.adversaryDecision = undefined;
      req.adversaryReason = undefined;
      saveRequest(group, req);
      console.log(`[consensus] ${req.id}: rebuttal by ${approver} → back to adversary review`);

      const chatDir = path.join(GROUPS_DIR, group, 'chat');
      if (!fs.existsSync(chatDir)) fs.mkdirSync(chatDir, { recursive: true });
      const msg = `[consensus #${req.id}] ⚠️ 反驳已提交 — @${req.adversary} 请再次审查。用 decide(group="${group}", decision="APPROVED|REJECTED", requestId="${req.id}") 回复。`;
      const ts2 = Date.now();
      const cf = path.join(chatDir, `${ts2}_system_re_review.md`);
      const cc = `---\nfrom: system\ndate: ${new Date().toISOString()}\n---\n\n${msg}\n`;
      const tmp = cf + '.tmp'; fs.writeFileSync(tmp, cc, 'utf-8'); fs.renameSync(tmp, cf);

      return { status: 'adversary_review', request: req, phase: 'rebuttal_submitted' };
    }

    // Rebuttal rejected → final reject
    req.status = 'rejected';
    saveRequest(group, req);
    console.log(`[consensus] ${req.id}: rebuttal by ${approver} rejected → REJECTED`);
    postResult(group, req, 'rejected');
    return { status: 'rejected', request: req, phase: 'rebuttal_rejected' };
  }

  // Primary decision
  const isApprover = req.approvers.some(a => a.toLowerCase() === approver.toLowerCase()) || (req.approvers.includes('human') && approver === 'me');
  if (!isApprover) return { status: 'not_an_approver' };

  req.decisions[approver] = decision;
  const rule = getRule(req.action, group);
  const logic: ConsensusLogic = rule?.logic || 'and';
  const threshold = rule?.threshold || rule?.quorum || 1;
  const total = req.approvers.length;

  const approved = Object.values(req.decisions).filter(d => d === 'APPROVED').length;
  const rejected = Object.values(req.decisions).filter(d => d === 'REJECTED').length;

  let isApproved = false, isRejected = false;

  switch (logic) {
    case 'or':
      if (approved >= (rule?.quorum || 1)) isApproved = true;
      if (rejected > 0 && approved < (rule?.quorum || 1)) isRejected = true; // first reject blocks if quorum not yet met
      break;
    case 'threshold':
      if (approved >= threshold) isApproved = true;
      if (rejected > (total - threshold)) isRejected = true; // cannot reach threshold anymore
      break;
    default: // 'and'
      if (approved >= total) isApproved = true;
      if (rejected > 0) isRejected = true;
      break;
  }

  if (isRejected) { req.status = 'rejected'; saveRequest(group, req); postResult(group, req, 'rejected'); return { status: 'rejected', request: req, phase: 'primary' }; }

  if (isApproved) {
    if (req.adversary && req.adversaryDecision !== 'APPROVED') {
      // Enter adversary review
      req.status = 'adversary_review';
      saveRequest(group, req);
      console.log(`[consensus] ${req.id}: approved → entering adversary review by ${req.adversary}`);

      // Post adversary request
      const chatDir = path.join(GROUPS_DIR, group, 'chat');
      if (!fs.existsSync(chatDir)) fs.mkdirSync(chatDir, { recursive: true });
      const msg = `[consensus #${req.id}] ⚠️ 复核阶段 — @${req.adversary} 请检查 ${approver} 的批准决策。用 decide(group="${group}", decision="APPROVED|REJECTED", requestId="${req.id}") 回复。`;
      const ts2 = Date.now();
      const cf = path.join(chatDir, `${ts2}_system_adversary.md`);
      const cc = `---\nfrom: system\ndate: ${new Date().toISOString()}\n---\n\n${msg}\n`;
      const tmp2 = cf + '.tmp'; fs.writeFileSync(tmp2, cc, 'utf-8'); fs.renameSync(tmp2, cf);

      return { status: 'adversary_review', request: req, phase: 'adversary_review' };
    }
    // No adversary or adversary already passed → approved
    req.status = 'approved'; saveRequest(group, req); postResult(group, req, 'approved');
    return { status: 'approved', request: req, phase: 'primary' };
  }

  saveRequest(group, req);
  return { status: 'pending', request: req, phase: 'primary' };
}

function postResult(group: string, req: ConsensusRequest, result: 'approved' | 'rejected'): void {
  const chatDir = path.join(GROUPS_DIR, group, 'chat');
  if (!fs.existsSync(chatDir)) fs.mkdirSync(chatDir, { recursive: true });
  const emoji = result === 'approved' ? '✅' : '❌';
  const msg = `[consensus #${req.id}] ${emoji} ${result === 'approved' ? '批准通过' : '被拒绝'}。${req.description}`;
  const ts = Date.now();
  const f = path.join(chatDir, `${ts}_system_result.md`);
  const c = `---\nfrom: system\ndate: ${new Date().toISOString()}\n---\n\n${msg}\n`;
  const tmp = f + '.tmp'; fs.writeFileSync(tmp, c, 'utf-8'); fs.renameSync(tmp, f);

  if (result === 'approved') executeApprovedAction(req);
}

// ── v0.4: Timeout handling — auto-reject expired requests ──

/** Check all pending requests and reject expired ones */
export function checkTimeouts(): number {
  let rejected = 0;
  if (!fs.existsSync(GROUPS_DIR)) return 0;
  for (const g of fs.readdirSync(GROUPS_DIR, { withFileTypes: true })) {
    if (!g.isDirectory() || g.name.startsWith('.')) continue;
    const d = requestsDir(g.name);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.json')) continue;
      try {
        const req: ConsensusRequest = JSON.parse(fs.readFileSync(path.join(d, f), 'utf-8'));
        if (req.status !== 'pending' && req.status !== 'adversary_review') continue;
        const elapsed = Date.now() - req.createdAt;
        if (elapsed > (req.timeoutMs || 86400_000)) {
          req.status = 'rejected';
          saveRequest(g.name, req);
          postResult(g.name, req, 'rejected');
          console.log(`[consensus] ${req.id}: expired after ${Math.round(elapsed / 60000)}min → REJECTED`);
          rejected++;
        }
      } catch {}
    }
  }
  return rejected;
}

// ── v0.4: PermissionKey auto-pass ──

/** Check if agent has the permissionKey for a rule — auto-pass without approval */
export function checkPermissionKey(agentName: string, action: string): boolean {
  const rule = getRule(action);
  if (!rule || !rule.permissionKey) return false;
  try {
    const cf = path.join(AGENTS_DIR, agentName, 'config.json');
    if (fs.existsSync(cf)) {
      const config = JSON.parse(fs.readFileSync(cf, 'utf-8'));
      return config.permissions?.[rule.permissionKey] === true;
    }
  } catch {}
  return false;
}

// ── Execution ────────────────────────────────────────────

const actionHandlers = new Map<string, (req: ConsensusRequest) => Promise<void>>();

export function registerHandler(action: string, handler: (req: ConsensusRequest) => Promise<void>): void { actionHandlers.set(action, handler); }

async function executeApprovedAction(req: ConsensusRequest): Promise<void> {
  const h = actionHandlers.get(req.action);
  if (h) { try { await h(req); } catch (e: any) { console.error(`[consensus] ${req.id}: exec fail: ${e.message}`); } }
}

// ── Default handlers ──────────────────────────────────────

export function initConsensusHandlers(): void {
  // group_delete: remove group directory
  registerHandler('group_delete', async (req) => {
    const d = path.join(GROUPS_DIR, req.group);
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    console.log(`[consensus] group_delete: ${req.group} deleted`);
  });

  // deploy: trigger workflow
  registerHandler('deploy', async (req) => {
    const { triggerWorkflow } = await import('./workflow-bridge');
    triggerWorkflow(req.group).catch(() => {});
  });

  // group_kick: remove member from group
  registerHandler('group_kick', async (req) => {
    const target = req.target;
    if (!target) { console.log(`[consensus] group_kick: no target specified`); return; }
    const agDir = path.join(GROUPS_DIR, req.group, 'Agents', target);
    if (fs.existsSync(agDir)) {
      fs.rmSync(agDir, { recursive: true, force: true });
      // Post system message to chat
      const chatDir = path.join(GROUPS_DIR, req.group, 'chat');
      if (fs.existsSync(chatDir)) {
        const msg = `${target} has been removed from the group by ${req.requestedBy}`;
        const ts = Date.now();
        const f = path.join(chatDir, `${ts}_system_kick.md`);
        const c = `---\nfrom: system\ndate: ${new Date().toISOString()}\n---\n\n${msg}\n`;
        const tmp = f + '.tmp'; fs.writeFileSync(tmp, c, 'utf-8'); fs.renameSync(tmp, f);
      }
      console.log(`[consensus] group_kick: removed ${target} from ${req.group}`);
    } else {
      console.log(`[consensus] group_kick: ${target} not found in ${req.group}`);
    }
  });

  // group_invite: create invitation
  registerHandler('group_invite', async (req) => {
    const target = req.target;
    if (!target) { console.log(`[consensus] group_invite: no target specified`); return; }
    const invDir = path.join(GROUPS_DIR, req.group, '.invitations');
    if (!fs.existsSync(invDir)) fs.mkdirSync(invDir, { recursive: true });
    const invFile = path.join(invDir, `${target}.json`);
    fs.writeFileSync(invFile, JSON.stringify({ invitedBy: req.requestedBy, invitedAt: Date.now() }), 'utf-8');
    // Post system message to chat
    const chatDir = path.join(GROUPS_DIR, req.group, 'chat');
    if (fs.existsSync(chatDir)) {
      const msg = `${target} has been invited to the group by ${req.requestedBy}`;
      const ts = Date.now();
      const f = path.join(chatDir, `${ts}_system_invite.md`);
      const c = `---\nfrom: system\ndate: ${new Date().toISOString()}\n---\n\n${msg}\n`;
      const tmp = f + '.tmp'; fs.writeFileSync(tmp, c, 'utf-8'); fs.renameSync(tmp, f);
    }
    console.log(`[consensus] group_invite: invited ${target} to ${req.group}`);
  });

  // group_set_admin: update group config
  registerHandler('group_set_admin', async (req) => {
    const target = req.target;
    if (!target) { console.log(`[consensus] group_set_admin: no target specified`); return; }
    const configPath = path.join(GROUPS_DIR, req.group, 'config.json');
    if (!fs.existsSync(configPath)) return;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!config.admins) config.admins = [];
    if (!config.admins.includes(target)) config.admins.push(target);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    // Post system message to chat
    const chatDir = path.join(GROUPS_DIR, req.group, 'chat');
    if (fs.existsSync(chatDir)) {
      const msg = `${target} has been set as admin of the group by ${req.requestedBy}`;
      const ts = Date.now();
      const f = path.join(chatDir, `${ts}_system_setadmin.md`);
      const c = `---\nfrom: system\ndate: ${new Date().toISOString()}\n---\n\n${msg}\n`;
      const tmp = f + '.tmp'; fs.writeFileSync(tmp, c, 'utf-8'); fs.renameSync(tmp, f);
    }
    console.log(`[consensus] group_set_admin: added ${target} as admin of ${req.group}`);
  });

  // workflow_create: create workflow YAML file
  registerHandler('workflow_create', async (req) => {
    // Workflow creation is already handled by the MCP tool before consensus.
    // This handler is called after approval — no additional action needed.
    console.log(`[consensus] workflow_create: approved for ${req.group}`);
  });

  // workflow_trigger: trigger workflow execution
  registerHandler('workflow_trigger', async (req) => {
    // Workflow trigger is already handled by the MCP tool.
    // This handler is called after approval — trigger the workflow.
    const { triggerWorkflow } = await import('./workflow-bridge');
    triggerWorkflow(req.group).catch(() => {});
    console.log(`[consensus] workflow_trigger: triggered for ${req.group}`);
  });

  // Other actions: log only
  for (const a of ['config_change', 'agent_create', 'workflow_step', 'critical_deploy']) {
    registerHandler(a, async (req) => { console.log(`[consensus] ${a} done: ${req.group}`); });
  }
}

// ── Recovery ──────────────────────────────────────────────

export function recoverPendingConsensus(): void {
  if (!fs.existsSync(GROUPS_DIR)) return;
  for (const g of fs.readdirSync(GROUPS_DIR, { withFileTypes: true })) {
    if (!g.isDirectory() || g.name.startsWith('.')) continue;
    const dir = path.join(GROUPS_DIR, g.name, '.consensus');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) { if (!f.endsWith('.json')) continue; try { const req: ConsensusRequest = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); if (req.status === 'pending' || req.status === 'adversary_review') { console.log(`[consensus] recovered #${req.id} in ${g.name}`); const chatDir = path.join(GROUPS_DIR, g.name, 'chat'); if (!fs.existsSync(chatDir)) fs.mkdirSync(chatDir, { recursive: true }); const entry = `---\nfrom: system\ndate: ${new Date().toISOString()}\n---\n\n[consensus #${req.id}] (恢复) — ${req.description}\n${req.status === 'adversary_review' ? '仍在等待复核。' : '请用 decide 回复。'}`; const fp = path.join(chatDir, `${Date.now()}_system_recover.md`); const tmp = fp + '.tmp'; fs.writeFileSync(tmp, entry, 'utf-8'); fs.renameSync(tmp, fp); } } catch {} }
  }
}
