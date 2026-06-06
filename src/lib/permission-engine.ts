/**
 * Permission Engine v0.4 — thin wrapper over consensus module.
 *
 * Flow:
 *   1. No consensus rule exists → ✅ pass through
 *   2. Agent has permissionKey → ✅ auto-pass
 *   3. No approvers in rule → ✅ pass through
 *   4. Already approved recently → ✅ pass through
 *   5. Otherwise → create consensus request, ⏳ wait
 *
 * v0.4: All rules now live in consensus.ts. This module is a thin entry point.
 */

import { AGENTS_DIR, GROUPS_DIR } from './data-dir';
import { checkPermissionKey, resolveApprovers, createRequest, getRule } from './consensus';
import fs from 'fs';
import path from 'path';

export interface PermissionResult {
  allowed: boolean;
  requestId?: string;
  message: string;
}

/**
 * Evaluate a tool call against the permission engine.
 */
export function checkToolPermission(agentName: string, toolName: string, context: Record<string, string>): PermissionResult {
  // Look up rule from consensus module (unified rules)
  const rule = getRule(toolName, context.group);
  if (!rule) {
    return { allowed: true, message: 'ok' };
  }

  // Step 1: Config permission check → auto-pass
  if (rule.permissionKey && checkPermissionKey(agentName, toolName)) {
    return { allowed: true, message: `${agentName} has ${rule.permissionKey}` };
  }

  // Step 2: No approvers defined or quorum=0 → pass through (no approval needed)
  if (!rule.approvers || rule.approvers.length === 0 || rule.quorum === 0) {
    return { allowed: true, message: 'ok' };
  }

  // Step 3: Check if there's already an approved request
  const existingId = findApprovedRequest(agentName, toolName, context);
  if (existingId) {
    return { allowed: true, message: `基于已批准的请求 #${existingId}` };
  }

  // Step 4: Resolve approvers using consensus module
  const group = context.group || '';
  const resolvedApprovers = resolveApprovers(rule, group);

  if (resolvedApprovers.length === 0) {
    return { allowed: false, message: `没有可用的审批人，操作被拒绝` };
  }

  // Step 5: Create consensus request via consensus module
  const adversaryName = rule.adversary
    ? resolveApprovers({ action: '', approvers: [rule.adversary], quorum: 1 }, group)[0]
    : undefined;

  // Extract target agent from context (for group_kick, group_invite, group_set_admin, etc.)
  const target = context.target || context.agent || undefined;

  const requestId = createRequest({
    action: rule.action,
    group,
    requestedBy: agentName,
    description: formatDescription(rule.description || rule.action, context),
    approvers: resolvedApprovers,
    adversary: adversaryName,
    target,
  });

  return {
    allowed: false,
    requestId,
    message: `需要审批，请求编号 #${requestId}，已通知 ${resolvedApprovers.join('、')}`,
  };
}

// ── Helpers ──────────────────────────────────────────────

function formatDescription(template: string, ctx: Record<string, string>): string {
  let s = template;
  for (const [k, v] of Object.entries(ctx)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  return s;
}

// Cache for approved requests (5 min TTL, matches the approval window)
const approvedRequestCache = new Map<string, { data: string | null; ts: number }>();
const APPROVED_CACHE_TTL = 30_000; // 30s cache (shorter than 5min approval window)

function findApprovedRequest(agentName: string, toolName: string, context: Record<string, string>): string | null {
  const group = context.group || '_global';
  const cacheKey = `${group}:${agentName}:${toolName}`;
  const cached = approvedRequestCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.ts) < APPROVED_CACHE_TTL) return cached.data;

  const dir = path.join(GROUPS_DIR, group, '.consensus');
  let result: string | null = null;

  if (fs.existsSync(dir)) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        if (
          data.action === toolName &&
          data.requestedBy === agentName &&
          data.status === 'approved' &&
          now - data.createdAt < 300_000 // 5 min window
        ) {
          result = data.id;
          break;
        }
      }
    } catch {}
  }

  approvedRequestCache.set(cacheKey, { data: result, ts: now });
  return result;
}
