import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { chatOnce } from '@/lib/chat';

// ── Types ──────────────────────────────────────────────

interface WorkflowStep {
  agent: string;
  action: string;
  notify?: string;
  condition?: string;
  prompt?: string;
}

interface WorkflowConfig {
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

interface StepResult {
  agent: string;
  action: string;
  decision: 'approved' | 'rejected' | 'deployed' | 'completed' | 'skipped' | 'error';
  reply: string;
  error?: string;
}

interface WorkflowContext {
  [agentName: string]: {
    decision: string;
    reply: string;
  };
}

// ── Helpers ────────────────────────────────────────────

const GROUPS_DIR = path.join(process.cwd(), 'Groups');
const AGENTS_DIR = path.join(process.cwd(), 'Agents');

/** Load workflow.yaml from a group directory */
function loadWorkflow(groupName: string): WorkflowConfig | null {
  const yamlPath = path.join(GROUPS_DIR, groupName, 'workflow.yaml');
  if (!fs.existsSync(yamlPath)) return null;

  try {
    const raw = fs.readFileSync(yamlPath, 'utf-8');
    const doc = yaml.load(raw) as any;
    if (!doc || !doc.name || !Array.isArray(doc.steps)) {
      return null;
    }
    return {
      name: doc.name,
      description: doc.description,
      steps: doc.steps.map((s: any, i: number) => ({
        agent: s.agent || '',
        action: s.action || '',
        notify: s.notify || undefined,
        condition: s.condition || undefined,
        prompt: s.prompt || undefined,
      })),
    };
  } catch {
    return null;
  }
}

/** Check if an agent exists */
function agentExists(name: string): boolean {
  return fs.existsSync(path.join(AGENTS_DIR, name));
}

/** Evaluate a condition string like "Bob.approved" against the workflow context */
function evaluateCondition(condition: string, ctx: WorkflowContext): boolean {
  // Format: AgentName.decisionValue
  const dotIdx = condition.lastIndexOf('.');
  if (dotIdx === -1) return false;
  const agent = condition.slice(0, dotIdx).trim();
  const expected = condition.slice(dotIdx + 1).trim().toLowerCase();
  const entry = ctx[agent];
  if (!entry) return false;
  return entry.decision.toLowerCase() === expected;
}

/** Parse an agent's reply to extract the decision keyword */
function parseDecision(reply: string, action: string): { decision: string; keyword: string } {
  const text = reply.toLowerCase();

  // Check for explicit keywords in priority order
  const keywords = [
    { word: 'approved', decision: 'approved' },
    { word: 'rejected', decision: 'rejected' },
    { word: 'deployed', decision: 'deployed' },
    { word: 'completed', decision: 'completed' },
    { word: 'done', decision: 'completed' },
  ];

  for (const kw of keywords) {
    // Look for the keyword as a standalone word (surrounded by non-alpha chars or boundaries)
    const re = new RegExp(`(?:^|[^a-z])${kw.word}(?:[^a-z]|$)`, 'i');
    if (re.test(text)) {
      return { decision: kw.decision, keyword: kw.word };
    }
  }

  // Fallback: if action only allows specific outcomes, pick one
  const actions = action.split('|').map(a => a.trim().toLowerCase());
  for (const act of actions) {
    const re = new RegExp(`(?:^|[^a-z])${act}(?:[^a-z]|$)`, 'i');
    if (re.test(text)) {
      return { decision: act, keyword: act };
    }
  }

  // No keyword found — treat as "completed" for non-decision steps
  return { decision: 'completed', keyword: '' };
}

/** Build a workflow prompt for a step */
function buildStepPrompt(
  step: WorkflowStep,
  stepIndex: number,
  totalSteps: number,
  workflowName: string,
  ctx: WorkflowContext,
): string {
  const parts: string[] = [];

  parts.push(`## 工作流: ${workflowName}`);
  parts.push(`步骤 ${stepIndex + 1}/${totalSteps}: ${step.agent} — ${step.action}`);
  parts.push('');

  // Context from previous steps
  const prevAgents = Object.keys(ctx);
  if (prevAgents.length > 0) {
    parts.push('### 前置步骤结果');
    for (const [agent, result] of Object.entries(ctx)) {
      parts.push(`- **${agent}**: ${result.decision.toUpperCase()}`);
      if (result.reply) {
        // Include a brief summary (first 300 chars)
        const summary = result.reply.length > 300
          ? result.reply.slice(0, 300) + '...(截断)'
          : result.reply;
        parts.push(`  回复摘要: ${summary}`);
      }
    }
    parts.push('');
  }

  // Custom prompt from workflow definition
  if (step.prompt) {
    parts.push('### 任务说明');
    parts.push(step.prompt.trim());
    parts.push('');
  }

  // Decision format instruction
  parts.push('### 回复格式要求');
  parts.push(`你的操作是: **${step.action}**`);
  parts.push('请在回复中明确写出你的决定（如 APPROVED、REJECTED、DEPLOYED、COMPLETED 等关键词）。');
  parts.push('用中文回复。');

  return parts.join('\n');
}

/** Send notification email to an agent */
function notifyAgent(
  fromAgent: string,
  toAgent: string,
  workflowName: string,
  decision: string,
  reply: string,
): void {
  const emailDir = path.join(AGENTS_DIR, toAgent, 'email');
  if (!fs.existsSync(emailDir)) {
    fs.mkdirSync(emailDir, { recursive: true });
  }

  const date = new Date();
  const dateStr = date.toISOString().split('T')[0];
  const timeStr = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${dateStr}_workflow_${workflowName}_${decision}.md`;

  const body = `---
from: ${fromAgent}
to: ${toAgent}
subject: [工作流] ${workflowName} — ${fromAgent} ${decision}
date: ${dateStr}
---

## 工作流通知

工作流 **${workflowName}** 中，**${fromAgent}** 已完成操作，结果为: **${decision.toUpperCase()}**

### ${fromAgent} 的回复

${reply}

---
请根据工作流规则继续下一步操作。
`;

  fs.writeFileSync(path.join(emailDir, filename), body, 'utf-8');
}

// ── Route Handler ───────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name: groupName } = await params;

  // Validate group name
  const groupDir = path.join(GROUPS_DIR, groupName);
  if (!fs.existsSync(groupDir)) {
    return NextResponse.json({ error: `Group "${groupName}" not found` }, { status: 404 });
  }

  // Load workflow
  const workflow = loadWorkflow(groupName);
  if (!workflow) {
    return NextResponse.json(
      { error: `No workflow.yaml found in group "${groupName}"` },
      { status: 404 },
    );
  }

  if (workflow.steps.length === 0) {
    return NextResponse.json({ error: 'Workflow has no steps' }, { status: 400 });
  }

  // Validate all agents exist
  for (const step of workflow.steps) {
    if (!step.agent) {
      return NextResponse.json({ error: 'Step missing agent name' }, { status: 400 });
    }
    if (!agentExists(step.agent)) {
      return NextResponse.json(
        { error: `Agent "${step.agent}" not found (step: ${step.action})` },
        { status: 400 },
      );
    }
  }

  // ── Execute workflow steps sequentially ──────────────
  const ctx: WorkflowContext = {};
  const results: StepResult[] = [];
  let aborted = false;

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];

    // Check condition
    if (step.condition) {
      const condMet = evaluateCondition(step.condition, ctx);
      if (!condMet) {
        const result: StepResult = {
          agent: step.agent,
          action: step.action,
          decision: 'skipped',
          reply: `Condition not met: ${step.condition}`,
        };
        results.push(result);
        continue;
      }
    }

    // Build prompt
    const prompt = buildStepPrompt(step, i, workflow.steps.length, workflow.name, ctx);

    // Call agent
    try {
      const { reply, events } = await chatOnce(step.agent, prompt, groupName);
      const parsed = parseDecision(reply, step.action);

      // Store in context
      ctx[step.agent] = {
        decision: parsed.decision,
        reply,
      };

      const result: StepResult = {
        agent: step.agent,
        action: step.action,
        decision: parsed.decision as StepResult['decision'],
        reply,
      };

      results.push(result);

      // Check if pipeline should abort (e.g., rejected)
      if (parsed.decision === 'rejected') {
        // Mark remaining steps as skipped
        for (let j = i + 1; j < workflow.steps.length; j++) {
          results.push({
            agent: workflow.steps[j].agent,
            action: workflow.steps[j].action,
            decision: 'skipped',
            reply: `Pipeline aborted: ${step.agent} rejected at step ${i + 1}`,
          });
        }
        aborted = true;
        break;
      }

      // Send notification if specified
      if (step.notify && !aborted) {
        const notifyTargets = step.notify.split(',').map(s => s.trim()).filter(Boolean);
        for (const target of notifyTargets) {
          if (agentExists(target)) {
            try {
              notifyAgent(step.agent, target, workflow.name, parsed.decision, reply);
            } catch {
              // Non-critical: notification failure shouldn't break the pipeline
            }
          }
        }
      }
    } catch (err: any) {
      const result: StepResult = {
        agent: step.agent,
        action: step.action,
        decision: 'error',
        reply: '',
        error: err.message || 'Unknown error',
      };
      results.push(result);

      // Abort on error
      for (let j = i + 1; j < workflow.steps.length; j++) {
        results.push({
          agent: workflow.steps[j].agent,
          action: workflow.steps[j].action,
          decision: 'skipped',
          reply: `Pipeline aborted: error at step ${i + 1} (${step.agent}: ${err.message})`,
        });
      }
      break;
    }
  }

  return NextResponse.json({
    workflow: workflow.name,
    group: groupName,
    aborted,
    completed: !aborted && results.length > 0 && results[results.length - 1].decision !== 'error',
    steps: results.length,
    results,
  });
}

/** GET — return workflow definition (read-only) */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name: groupName } = await params;

  const groupDir = path.join(GROUPS_DIR, groupName);
  if (!fs.existsSync(groupDir)) {
    return NextResponse.json({ error: `Group "${groupName}" not found` }, { status: 404 });
  }

  const workflow = loadWorkflow(groupName);
  if (!workflow) {
    return NextResponse.json(
      { error: `No workflow.yaml found in group "${groupName}"` },
      { status: 404 },
    );
  }

  return NextResponse.json(workflow);
}
