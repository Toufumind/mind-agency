/**
 * Agent Tasks API — v0.4
 *
 * GET /api/agents/{name}/tasks → returns all tasks assigned to this agent
 * across all running and completed workflows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { GROUPS_DIR } from '@/lib/data-dir';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

interface AgentTask {
  workflowName: string;
  group: string;
  stepId: string;
  action: string;
  prompt: string;
  status: string; // pending | in_progress | completed | failed | skipped
  output?: string;
  report?: { status: string; summary: string; details: string; timestamp: number };
  startedAt?: number;
  completedAt?: number;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const tasks: AgentTask[] = [];

  if (!fs.existsSync(GROUPS_DIR)) {
    return NextResponse.json({ tasks });
  }

  // Scan all groups for workflows
  for (const g of fs.readdirSync(GROUPS_DIR, { withFileTypes: true })) {
    if (!g.isDirectory() || g.name.startsWith('.')) continue;

    const wfPath = path.join(GROUPS_DIR, g.name, 'workflow.yaml');
    if (!fs.existsSync(wfPath)) continue;

    try {
      const yaml = await import('js-yaml');
      const raw = fs.readFileSync(wfPath, 'utf-8');
      const def = yaml.load(raw) as any;
      if (!def?.steps) continue;

      for (const step of def.steps) {
        if (step.agent === name) {
          tasks.push({
            workflowName: def.name || 'unnamed',
            group: g.name,
            stepId: step.id || `step_${Math.random().toString(36).slice(2, 6)}`,
            action: step.action || 'execute',
            prompt: step.prompt || '',
            status: 'pending',
          });
        }
      }
    } catch {}
  }

  // Check for task reports (completed tasks)
  const reportsDir = path.join(PROJECT_ROOT, '.mind', 'agents', name, '.task-reports');
  if (fs.existsSync(reportsDir)) {
    for (const f of fs.readdirSync(reportsDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const report = JSON.parse(fs.readFileSync(path.join(reportsDir, f), 'utf-8'));
        // Find matching task and update status
        const existing = tasks.find(t => t.stepId === report.stepId);
        if (existing) {
          existing.status = report.status === 'APPROVED' ? 'completed' : 'failed';
          existing.report = { status: report.status, summary: report.summary, details: report.details, timestamp: report.timestamp };
        } else {
          tasks.push({
            workflowName: 'unknown',
            group: 'unknown',
            stepId: report.stepId,
            action: 'report',
            prompt: '',
            status: report.status === 'APPROVED' ? 'completed' : 'failed',
            report: { status: report.status, summary: report.summary, details: report.details, timestamp: report.timestamp },
          });
        }
      } catch {}
    }
  }

  // Sort: in_progress first, then pending, then completed/failed
  const order: Record<string, number> = { in_progress: 0, pending: 1, failed: 2, completed: 3, skipped: 4 };
  tasks.sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5));

  return NextResponse.json({ tasks, total: tasks.length });
}

const PROJECT_ROOT = process.env.MIND_DATA_DIR || process.cwd();
