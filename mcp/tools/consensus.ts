/**
 * MCP Server — Consensus / Decision tools
 *
 * Tools: decide, consensus_list
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { groupsDir, exists, readDir, emitBusEvent, writeAudit, PROJECT_ROOT } from './shared';

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
    const gDir = path.join(groupsDir(), group);
    const consensusDir = path.join(gDir, '.consensus');

    // v0.4: Find pending requests — try specific requestId, then find any pending for this agent
    if (exists(consensusDir)) {
      let targetReq: any = null;
      let targetFile: string | null = null;

      if (requestId) {
        const reqFile = path.join(consensusDir, `${requestId}.json`);
        if (exists(reqFile)) {
          try { targetReq = JSON.parse(fs.readFileSync(reqFile, 'utf-8')); targetFile = reqFile; } catch {}
        }
      }
      if (!targetReq) {
        for (const f of readDir(consensusDir)) {
          if (!f.name.endsWith('.json')) continue;
          try {
            const req = JSON.parse(fs.readFileSync(path.join(consensusDir, f.name), 'utf-8'));
            if (req.status !== 'pending' && req.status !== 'rebuttal') continue;
            const isApprover = req.approvers?.some((a: string) => a.toLowerCase() === agentName.toLowerCase()) ||
              (req.approvers?.includes('human') && agentName === 'me') ||
              req.requestedBy === agentName;
            if (isApprover) { targetReq = req; targetFile = path.join(consensusDir, f.name); break; }
          } catch {}
        }
      }
      if (targetReq && targetFile) {
        if (!targetReq.decisions) targetReq.decisions = {};
        targetReq.decisions[agentName] = { decision, reason: reason || '', timestamp: Date.now() };
        if (decision === 'APPROVED') targetReq.status = 'approved';
        else targetReq.status = 'rejected';
        fs.writeFileSync(targetFile, JSON.stringify(targetReq, null, 2), 'utf-8');
        emitBusEvent('task.completed', { taskId: `consensus:${group}:${targetReq.id}`, by: agentName, decision });
        respond(id, { content: [{ type: 'text', text: `决策已提交: ${decision} — ${targetReq.description || targetReq.action}` }] });
        return true;
      }
    }
    // Fallback
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
