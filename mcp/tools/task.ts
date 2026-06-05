/**
 * MCP Server — Task reporting tool
 *
 * Agents use this tool to report task completion back to the workflow engine.
 * The workflow engine reads the report as the step's structured result.
 *
 * Usage:
 *   task(action="report", step_id="code_review", status="APPROVED", summary="...", details="...")
 *   task(action="report", step_id="code_review", status="REJECTED", summary="...", details="...")
 *   task(action="read", step_id="code_review")  -- workflow engine reads the report
 */

import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT } from './shared';

export interface ToolDef { name: string; description: string; inputSchema: any; }

const REPORTS_DIR = '.task-reports';

function getReportsDir(agentName: string): string {
  const dir = path.join(PROJECT_ROOT, '.mind', 'agents', agentName, REPORTS_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function taskTools(): ToolDef[] {
  return [
    {
      name: 'task',
      description: '向工作流引擎报告任务完成状态。Agent 完成任务后必须调用此工具。',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'report（报告结果）或 read（读取结果）' },
          step_id: { type: 'string', description: '步骤 ID' },
          status: { type: 'string', description: 'APPROVED 或 REJECTED' },
          summary: { type: 'string', description: '结果摘要（必填）' },
          details: { type: 'string', description: '详细说明（可选）' },
        },
        required: ['action', 'step_id'],
      },
    },
  ];
}

export async function handleTaskTool(
  name: string, args: any, agentName: string,
  respond: (id: string, msg: any) => void, id: string
): Promise<boolean> {
  if (name !== 'task') return false;

  const { action, step_id, status, summary, details } = args;
  if (!step_id) {
    respond(id, { content: [{ type: 'text', text: 'step_id required' }], isError: true });
    return true;
  }

  if (action === 'report') {
    if (!status || !summary) {
      respond(id, { content: [{ type: 'text', text: 'status and summary required' }], isError: true });
      return true;
    }
    const report = {
      stepId: step_id,
      agent: agentName,
      status: status.toUpperCase(),
      summary,
      details: details || '',
      timestamp: Date.now(),
    };
    const dir = getReportsDir(agentName);
    const fp = path.join(dir, `${step_id}.json`);
    fs.writeFileSync(fp, JSON.stringify(report, null, 2), 'utf-8');
    respond(id, { content: [{ type: 'text', text: `任务报告已提交: ${status} — ${summary}` }] });
    return true;
  }

  if (action === 'read') {
    const dir = getReportsDir(agentName);
    const fp = path.join(dir, `${step_id}.json`);
    if (!fs.existsSync(fp)) {
      respond(id, { content: [{ type: 'text', text: `未找到步骤 ${step_id} 的报告` }] });
      return true;
    }
    const report = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    respond(id, {
      content: [{
        type: 'text',
        text: `步骤: ${report.stepId}\n状态: ${report.status}\n摘要: ${report.summary}\n详情: ${report.details || '无'}`,
      }],
    });
    return true;
  }

  respond(id, { content: [{ type: 'text', text: `未知 action: ${action}. 使用 report 或 read` }], isError: true });
  return true;
}
