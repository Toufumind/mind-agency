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
    { name: 'workflow_callback', description: '报告工作流步骤完成结果。当 workflow 引擎通知你执行任务后，用此工具回调结果。', inputSchema: { type: 'object', properties: { runId: { type: 'string', description: '工作流运行 ID' }, stepId: { type: 'string', description: '步骤 ID' }, status: { type: 'string', description: 'APPROVED | REJECTED | COMPLETED | FAILED' }, summary: { type: 'string', description: '结果摘要' }, details: { type: 'string', description: '详细说明' } }, required: ['runId', 'stepId', 'status', 'summary'] } },
    { name: 'workflow_create', description: '创建一个 Workflow YAML 文件到群组中。可设置触发方式：manual（手动）、file_change（文件变更）、schedule（定时）、event（事件）。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, steps: { type: 'string', description: '步骤列表（JSON 数组字符串）' }, trigger: { type: 'string', description: '触发方式：manual/file_change/schedule/event' }, cron: { type: 'string', description: '定时触发的 cron 表达式（仅 schedule 类型）' }, reviewer: { type: 'string', description: '默认审查者 Agent（可选，每步自动审查）' }, onReject: { type: 'string', description: '审查拒绝后的行为：retry（自动重做）或 fail（直接失败）' }, maxRejectRetries: { type: 'number', description: '审查拒绝后最大重试次数（默认 3）' } }, required: ['group', 'name', 'steps'] } },
    { name: 'workflow_trigger', description: '触发群组的工作流。', inputSchema: { type: 'object', properties: { group: { type: 'string' } }, required: ['group'] } },
    { name: 'workflow_status', description: '查询工作流运行状态和触发器状态。', inputSchema: { type: 'object', properties: { group: { type: 'string' } }, required: [] } },
    { name: 'workflow_approve', description: '审批工作流中的人工审批节点。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, approvalId: { type: 'string' }, decision: { type: 'string' } }, required: ['group', 'approvalId', 'decision'] } },
    { name: 'workflow_cancel', description: '取消一个正在运行的工作流。', inputSchema: { type: 'object', properties: { group: { type: 'string' } }, required: ['group'] } },
    { name: 'workflow_add_step', description: '向运行中的工作流动态添加步骤。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, step_id: { type: 'string' }, agent: { type: 'string' }, action: { type: 'string' }, prompt: { type: 'string' }, depends_on: { type: 'string', description: '依赖的步骤ID，逗号分隔' }, reviewer: { type: 'string', description: '审查者 Agent' }, onReject: { type: 'string', description: '审查拒绝后的行为：retry 或 fail' }, maxRejectRetries: { type: 'number', description: '审查拒绝后最大重试次数' } }, required: ['group', 'step_id', 'agent', 'action', 'prompt'] } },
    { name: 'workflow_delete_step', description: '从运行中的工作流删除步骤。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, step_id: { type: 'string' } }, required: ['group', 'step_id'] } },
    { name: 'workflow_modify_step', description: '修改运行中工作流的步骤属性。', inputSchema: { type: 'object', properties: { group: { type: 'string' }, step_id: { type: 'string' }, agent: { type: 'string' }, action: { type: 'string' }, prompt: { type: 'string' }, reviewer: { type: 'string' }, onReject: { type: 'string', description: '审查拒绝后的行为：retry 或 fail' } }, required: ['group', 'step_id'] } },
  ];
}

export async function handleWorkflowTool(
  name: string, args: any, agentName: string,
  respond: (id: string, msg: any) => void, id: string
): Promise<boolean> {
  const a = args;

  if (name === 'workflow_callback') {
    const { runId, stepId, status, summary, details } = a;
    if (!runId || !stepId || !status || !summary) {
      respond(id, { content: [{ type: 'text', text: 'runId, stepId, status, summary required' }], isError: true }); return true;
    }
    const output = `${status}: ${summary}${details ? '\n' + details : ''}`;
    httpPost(`${WS_BASE_URL}/workflows/callback`, { runId, stepId, output });
    emitBusEvent('task.completed', { taskId: `workflow:${runId}`, stepId, by: agentName, status });
    respond(id, { content: [{ type: 'text', text: `步骤 ${stepId} 结果已报告: ${status}` }] });
    return true;
  }

  if (name === 'workflow_create') {
    const { group, name: wfName, description, steps: stepsJson } = a;
    if (!group || !wfName || !stepsJson) { respond(id, { content: [{ type: 'text', text: `错误：缺少必填参数。需要: group="${group || '???'}", name="${wfName || '???'}", steps（JSON 数组）` }], isError: true }); return true; }
    let steps;
    try { steps = JSON.parse(stepsJson); } catch { respond(id, { content: [{ type: 'text', text: 'steps must be valid JSON array' }], isError: true }); return true; }
    if (!Array.isArray(steps) || steps.length === 0) { respond(id, { content: [{ type: 'text', text: '错误：steps 不能为空数组。请提供至少一个步骤，格式: [{"id":"step1","agent":"Alice","action":"review","prompt":"..."}]' }], isError: true }); return true; }

    // Validate step ID uniqueness
    const stepIds = steps.map((s: any) => s.id).filter(Boolean);
    const dupIds = stepIds.filter((id: string, i: number) => stepIds.indexOf(id) !== i);
    if (dupIds.length > 0) {
      respond(id, { content: [{ type: 'text', text: `错误：存在重复的步骤 ID: ${[...new Set(dupIds)].join(', ')}。每个步骤必须有唯一的 ID。` }], isError: true });
      return true;
    }

    // Validate each step has required fields (trigger steps don't need agent)
    for (const step of steps) {
      if (!step.id) { respond(id, { content: [{ type: 'text', text: '错误：每个步骤必须有 id 字段' }], isError: true }); return true; }
      const isTrigger = step.type === 'trigger' || step.trigger;
      if (!isTrigger && !step.agent) { respond(id, { content: [{ type: 'text', text: `错误：步骤 "${step.id}" 缺少 agent 字段` }], isError: true }); return true; }
    }

    // v0.4: Validate agent existence (skip trigger steps)
    const agentsDir = path.join(PROJECT_ROOT, 'Agents');
    for (const step of steps) {
      const isTrigger = step.type === 'trigger' || step.trigger;
      if (isTrigger) continue;
      if (step.agent && step.agent !== 'unknown') {
        const agentDir = path.join(agentsDir, step.agent);
        if (!fs.existsSync(agentDir)) {
          respond(id, { content: [{ type: 'text', text: `警告：Agent "${step.agent}" 不存在于 Agents/ 目录。步骤 ${step.id} 将无法执行。` }] });
          // Don't block creation — just warn
        }
      }
    }

    // v0.4: Add default reviewer to all steps if specified
    if (a.reviewer) {
      for (const step of steps) {
        if (!step.reviewer) step.reviewer = a.reviewer;
      }
    }

    // v0.5: Add default onReject to all steps if specified
    if (a.onReject) {
      for (const step of steps) {
        if (!step.onReject) step.onReject = a.onReject;
      }
    }
    if (a.maxRejectRetries) {
      for (const step of steps) {
        if (!step.maxRejectRetries) step.maxRejectRetries = a.maxRejectRetries;
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
    const { group, step_id, agent, action, prompt, depends_on, reviewer, onReject, maxRejectRetries } = a;
    if (!group || !step_id || !agent || !action || !prompt) {
      respond(id, { content: [{ type: 'text', text: 'group, step_id, agent, action, prompt required' }], isError: true }); return true;
    }
    httpPost(`${WS_BASE_URL}/workflows/add-step`, { group, step_id, agent, action, prompt, depends_on, reviewer, onReject, maxRejectRetries });
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
    const { group, step_id, agent, action, prompt, reviewer, onReject } = a;
    if (!group || !step_id) { respond(id, { content: [{ type: 'text', text: 'group and step_id required' }], isError: true }); return true; }
    httpPost(`${WS_BASE_URL}/workflows/modify-step`, { group, step_id, agent, action, prompt, reviewer, onReject });
    respond(id, { content: [{ type: 'text', text: `step ${step_id} modified in ${group} workflow` }] });
    return true;
  }

  return false;
}
