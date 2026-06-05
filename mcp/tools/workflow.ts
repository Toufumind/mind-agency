/**
 * MCP Server — Workflow tools
 *
 * Tools: workflow_create, workflow_trigger, workflow_status, workflow_approve, workflow_cancel
 */

import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
import { groupsDir, exists, appendToChat, triggerPoll, emitBusEvent, writeAudit, httpPost, fetchJSON, WS_BASE_URL, PROJECT_ROOT } from './shared';

export interface ToolDef { name: string; description: string; inputSchema: any; }

export function workflowTools(): ToolDef[] {
  return [
    { name: 'workflow_create', description: '创建一个 Workflow YAML 文件到群组中。可设置触发方式：manual（手动）、file_change（文件变更）、schedule（定时）、event（事件）。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, steps: { type: 'string', description: '步骤列表（JSON 数组字符串）' }, trigger: { type: 'string', description: '触发方式：manual/file_change/schedule/event' }, cron: { type: 'string', description: '定时触发的 cron 表达式（仅 schedule 类型）' }, reviewer: { type: 'string', description: '默认审查者 Agent（可选，每步自动审查）' } }, required: ['group', 'name', 'steps'] } },
    { name: 'workflow_trigger', description: '触发群组的工作流。', inputSchema: { type: 'object', properties: { group: { type: 'string' } }, required: ['group'] } },
    { name: 'workflow_status', description: '查询工作流运行状态和触发器状态。', inputSchema: { type: 'object', properties: { group: { type: 'string' } }, required: [] } },
    { name: 'workflow_approve', description: '审批工作流中的人工审批节点。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, approvalId: { type: 'string' }, decision: { type: 'string' } }, required: ['group', 'approvalId', 'decision'] } },
    { name: 'workflow_cancel', description: '取消一个正在运行的工作流。', inputSchema: { type: 'object', properties: { group: { type: 'string' } }, required: ['group'] } },
    { name: 'workflow_add_step', description: '向运行中的工作流动态添加步骤。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, step_id: { type: 'string' }, agent: { type: 'string' }, action: { type: 'string' }, prompt: { type: 'string' }, depends_on: { type: 'string', description: '依赖的步骤ID，逗号分隔' }, reviewer: { type: 'string', description: '审查者 Agent' } }, required: ['group', 'step_id', 'agent', 'action', 'prompt'] } },
    { name: 'workflow_delete_step', description: '从运行中的工作流删除步骤。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, step_id: { type: 'string' } }, required: ['group', 'step_id'] } },
    { name: 'workflow_modify_step', description: '修改运行中工作流的步骤属性。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, step_id: { type: 'string' }, agent: { type: 'string' }, action: { type: 'string' }, prompt: { type: 'string' }, reviewer: { type: 'string' } }, required: ['group', 'step_id'] } },
  ];
}

export async function handleWorkflowTool(
  name: string, args: any, agentName: string,
  respond: (id: string, msg: any) => void, id: string
): Promise<boolean> {
  const a = args;

  if (name === 'workflow_create') {
    const { group, name: wfName, description, steps: stepsJson } = a;
    if (!group || !wfName || !stepsJson) { respond(id, { content: [{ type: 'text', text: 'group, name, and steps required' }], isError: true }); return true; }
    let steps;
    try { steps = JSON.parse(stepsJson); } catch { respond(id, { content: [{ type: 'text', text: 'steps must be valid JSON array' }], isError: true }); return true; }
    if (!Array.isArray(steps) || steps.length === 0) { respond(id, { content: [{ type: 'text', text: 'steps must be non-empty array' }], isError: true }); return true; }

    // v0.4: Add default reviewer to all steps if specified
    if (a.reviewer) {
      for (const step of steps) {
        if (!step.reviewer) step.reviewer = a.reviewer;
      }
    }

    // v0.4: Build trigger config
    const triggerConfig: any = a.trigger ? { type: a.trigger } : undefined;
    if (a.trigger === 'schedule' && a.cron) {
      triggerConfig.cron = a.cron;
    }

    const wfDef: any = { name: wfName, description: description || '', steps };
    if (triggerConfig) wfDef.trigger = triggerConfig;
    const wfPath = path.join(groupsDir(), group, 'workflow.yaml');
    fs.writeFileSync(wfPath, yaml.dump(wfDef), 'utf-8');
    appendToChat(group, agentName, `创建了 workflow "${wfName}" (${steps.length} steps)`);
    triggerPoll(agentName, group);
    respond(id, { content: [{ type: 'text', text: `created workflow "${wfName}" in ${group}. Use workflow_trigger to start it.` }] });
    return true;
  }

  if (name === 'workflow_trigger') {
    const { group } = a;
    if (!group) { respond(id, { content: [{ type: 'text', text: 'group required' }], isError: true }); return true; }
    const wfPath = path.join(groupsDir(), group, 'workflow.yaml');
    if (!exists(wfPath)) { respond(id, { content: [{ type: 'text', text: `no workflow.yaml in ${group}` }], isError: true }); return true; }
    httpPost(`${WS_BASE_URL}/workflows/run`, { yaml: fs.readFileSync(wfPath, 'utf-8'), group });
    emitBusEvent('task.created', { title: `Workflow triggered for ${group}`, agent: agentName, group });
    respond(id, { content: [{ type: 'text', text: `workflow triggered for group "${group}"` }] });
    return true;
  }

  if (name === 'workflow_status') {
    const { group } = a;
    try {
      const statsRaw = await fetchJSON(`${WS_BASE_URL}/workflows/stats`);
      const stats = statsRaw as any;
      let statsText = stats
        ? `Workflows: ${stats.totalRuns} total, ${stats.activeRuns} active, ${stats.completedRuns} completed, ${stats.failedRuns} failed`
        : 'No workflow stats available';
      if (group) {
        const runs = (stats?.runs || []).filter((r: any) => r.group === group);
        statsText += `\n\n${group}: ${runs.length} run(s)`;
        for (const r of runs) statsText += `\n  - ${r.workflowName} (${r.runId.slice(0, 8)}): ${r.status}`;
      }
      respond(id, { content: [{ type: 'text', text: statsText }] });
    } catch { respond(id, { content: [{ type: 'text', text: 'workflow stats unavailable' }], isError: true }); }
    return true;
  }

  if (name === 'workflow_approve') {
    const { group, approvalId, decision } = a;
    if (!group || !approvalId || !decision) { respond(id, { content: [{ type: 'text', text: 'group, approvalId, decision required' }], isError: true }); return true; }
    httpPost(`${WS_BASE_URL}/workflows/approve`, { approvalId, decision });
    emitBusEvent('task.completed', { taskId: `workflow:${group}`, by: agentName, decision, approvalId });
    respond(id, { content: [{ type: 'text', text: `approval ${decision} submitted for ${approvalId}` }] });
    return true;
  }

  if (name === 'workflow_cancel') {
    const { group } = a;
    if (!group) { respond(id, { content: [{ type: 'text', text: 'group required' }], isError: true }); return true; }
    try {
      const runsRaw = await fetchJSON(`${WS_BASE_URL}/workflows/stats`);
      const runs = (runsRaw as any)?.runs || [];
      const activeRun = runs.find((r: any) => r.group === group && r.status === 'running');
      if (!activeRun) { respond(id, { content: [{ type: 'text', text: `no active workflow in ${group}` }] }); return true; }
      httpPost(`${WS_BASE_URL}/workflows/cancel`, { runId: activeRun.runId });
      respond(id, { content: [{ type: 'text', text: `workflow cancelled for ${group}` }] });
    } catch { respond(id, { content: [{ type: 'text', text: 'failed to cancel workflow' }], isError: true }); }
    return true;
  }

  if (name === 'workflow_add_step') {
    const { group, step_id, agent, action, prompt, depends_on, reviewer } = a;
    if (!group || !step_id || !agent || !action || !prompt) {
      respond(id, { content: [{ type: 'text', text: 'group, step_id, agent, action, prompt required' }], isError: true }); return true;
    }
    httpPost(`${WS_BASE_URL}/workflows/add-step`, { group, step_id, agent, action, prompt, depends_on, reviewer });
    respond(id, { content: [{ type: 'text', text: `step ${step_id} added to ${group} workflow` }] });
    return true;
  }

  if (name === 'workflow_delete_step') {
    const { group, step_id } = a;
    if (!group || !step_id) { respond(id, { content: [{ type: 'text', text: 'group and step_id required' }], isError: true }); return true; }
    httpPost(`${WS_BASE_URL}/workflows/delete-step`, { group, step_id });
    respond(id, { content: [{ type: 'text', text: `step ${step_id} deleted from ${group} workflow` }] });
    return true;
  }

  if (name === 'workflow_modify_step') {
    const { group, step_id, agent, action, prompt, reviewer } = a;
    if (!group || !step_id) { respond(id, { content: [{ type: 'text', text: 'group and step_id required' }], isError: true }); return true; }
    httpPost(`${WS_BASE_URL}/workflows/modify-step`, { group, step_id, agent, action, prompt, reviewer });
    respond(id, { content: [{ type: 'text', text: `step ${step_id} modified in ${group} workflow` }] });
    return true;
  }

  return false;
}
