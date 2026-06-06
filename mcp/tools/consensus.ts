/**
 * MCP Server — Consensus / Decision tools
 *
 * Tools: decide, consensus_list
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { groupsDir, exists, readDir, emitBusEvent, writeAudit, PROJECT_ROOT } from './shared';
import { submitDecision, listPendingRequests } from '../../src/lib/consensus';

export interface ToolDef { name: string; description: string; inputSchema: any; }

export function consensusTools(): ToolDef[] {
  return [
    { name: 'decide', description: '提交一个审批决策。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, decision: { type: 'string' }, reason: { type: 'string' }, requestId: { type: 'string' } }, required: ['group', 'decision'] } },
    { name: 'consensus_list', description: '列出当前群组中所有等待审批的共识请求。', inputSchema: { type: 'object', properties: { group: { type: 'string' } }, required: [] } },
  ];
}

export async function handleConsensusTool(
  name: string, args: any, agentName: string,
  respond: (id: string, msg: any) => void, id: string
): Promise<boolean> {
  const a = args;

  if (name === 'decide') {
    const { group, decision, reason, requestId } = a;
    if (!group || !decision) { respond(id, { content: [{ type: 'text', text: `错误：缺少参数。需要: group="${group || '???'}", decision="APPROVED|REJECTED"` }], isError: true }); return true; }
    if (!['APPROVED', 'REJECTED'].includes(decision)) { respond(id, { content: [{ type: 'text', text: `错误：decision 必须是 APPROVED 或 REJECTED，当前值: "${decision}"` }], isError: true }); return true; }

    // v0.4: Use unified submitDecision from consensus engine
    // This ensures adversary review, postResult, and executeApprovedAction are all triggered
    const pendingReqs = listPendingRequests(group);

    // Find target request: try specific requestId, then find any pending for this agent
    let targetId: string | undefined;
    if (requestId) {
      const found = pendingReqs.find(r => r.id === requestId);
      if (found) targetId = found.id;
    }
    if (!targetId) {
      const found = pendingReqs.find(r =>
        (r.status === 'pending' || r.status === 'rebuttal') &&
        (r.approvers?.some((a: string) => a.toLowerCase() === agentName.toLowerCase()) ||
         (r.approvers?.includes('human') && agentName === 'me') ||
         r.requestedBy === agentName)
      );
      if (found) targetId = found.id;
    }

    if (targetId) {
      const result = submitDecision(group, targetId, agentName, decision as 'APPROVED' | 'REJECTED');
      if (result.status === 'not_found') {
        respond(id, { content: [{ type: 'text', text: `未找到请求 #${targetId}` }], isError: true });
      } else if (result.status === 'not_an_approver') {
        respond(id, { content: [{ type: 'text', text: `你不是请求 #${targetId} 的审批人` }], isError: true });
      } else if (result.status === 'already_decided') {
        respond(id, { content: [{ type: 'text', text: `请求 #${targetId} 已经被决定: ${result.request?.status}` }] });
      } else {
        const statusText = result.status === 'approved' ? '✅ 批准通过' :
          result.status === 'rejected' ? '❌ 被拒绝' :
          result.status === 'adversary_review' ? '🔍 进入复核阶段' :
          result.status === 'rebuttal' ? '💬 等待反驳' :
          `⏳ ${result.status}`;
        const desc = result.request?.description || result.request?.action || '';
        respond(id, { content: [{ type: 'text', text: `${statusText} — ${desc}` }] });
        emitBusEvent('task.completed', { taskId: `consensus:${group}:${targetId}`, by: agentName, decision });
      }
      return true;
    }

    // Fallback: no matching request found
    const gDir = path.join(groupsDir(), group);
    const decDir = path.join(gDir, '.decisions');
    if (!exists(decDir)) fs.mkdirSync(decDir, { recursive: true });
    const decFile = path.join(decDir, `${Date.now()}_${agentName}.json`);
    fs.writeFileSync(decFile, JSON.stringify({ agent: agentName, decision, reason: reason || '', timestamp: Date.now() }), 'utf-8');
    writeAudit({ agent: agentName, action: 'workflow.decide', resource: `group:${group}`, details: decision });
    respond(id, { content: [{ type: 'text', text: `决策已记录: ${decision}（无匹配请求，已创建决策文件）` }] });
    return true;
  }

  if (name === 'consensus_list') {
    const group = a.group;
    const results: string[] = [];
    const gd = groupsDir();
    if (!exists(gd)) { respond(id, { content: [{ type: 'text', text: '暂无待审批请求' }] }); return true; }
    const groups = group ? [group] : readDir(gd).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
    for (const g of groups) {
      const consensusDir = path.join(gd, g.name || g, '.consensus');
      if (!exists(consensusDir)) continue;
      for (const f of readDir(consensusDir)) {
        if (!f.name.endsWith('.json')) continue;
        try {
          const req = JSON.parse(fs.readFileSync(path.join(consensusDir, f.name), 'utf-8'));
          if (req.status === 'pending' || req.status === 'adversary_review') {
            results.push(`[${g.name || g}] #${f.name.slice(0, 8)} — ${req.action || 'unknown'} by ${req.requestedBy || '?'} (${req.status})`);
          }
        } catch { /* skip */ }
      }
    }
    respond(id, { content: [{ type: 'text', text: results.length > 0 ? results.join('\n') : '暂无待审批请求' }] });
    return true;
  }

  return false;
}
