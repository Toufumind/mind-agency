import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MIND_DIR } from '@/lib/data-dir';

const LEARNING_DIR = path.join(MIND_DIR, 'learning');

function ensureDir() {
  if (!fs.existsSync(LEARNING_DIR)) fs.mkdirSync(LEARNING_DIR, { recursive: true });
}

// GET /api/learning?group=<name>&limit=N — get learning records for a group
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const group = searchParams.get('group');
  const limit = parseInt(searchParams.get('limit') || '20');
  const agent = searchParams.get('agent');
  const workflow = searchParams.get('workflow');

  ensureDir();

  if (!group) {
    // List all groups with learning records
    const files = fs.readdirSync(LEARNING_DIR).filter(f => f.startsWith('learning-') && f.endsWith('.jsonl'));
    const groups = files.map(f => f.replace('learning-', '').replace('.jsonl', ''));
    return NextResponse.json({ groups });
  }

  const logFile = path.join(LEARNING_DIR, `learning-${group}.jsonl`);
  if (!fs.existsSync(logFile)) {
    return NextResponse.json({ records: [], summary: { avgTotal: 0, count: 0, approved: 0, needsRevision: 0 } });
  }

  let lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
  let records = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  // Filter by agent if specified
  if (agent) {
    records = records.filter((r: any) => r.agent === agent);
  }
  // Filter by workflow if specified
  if (workflow) {
    records = records.filter((r: any) => r.workflow === workflow);
  }

  records = records.slice(-limit);

  // Compute summary
  const totals = records.map((r: any) => r.evaluation?.total || 0);
  const approved = records.filter((r: any) => r.evaluation?.verdict === 'APPROVED').length;
  const needsRevision = records.filter((r: any) => r.evaluation?.verdict === 'NEEDS_REVISION').length;
  const summary = {
    avgTotal: totals.length > 0 ? Math.round(totals.reduce((a: number, b: number) => a + b, 0) / totals.length) : 0,
    count: records.length,
    approved,
    needsRevision,
    approvalRate: records.length > 0 ? Math.round(approved / records.length * 100) : 0,
  };

  // Extract common feedback themes
  const feedbacks = records
    .map((r: any) => r.evaluation?.feedback)
    .filter(Boolean);
  const commonFeedback = feedbacks.slice(-5); // Last 5 feedback items

  return NextResponse.json({ records, summary, commonFeedback });
}

// POST /api/learning — manually add a learning record
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { group, workflow, stepId, action, agent, evaluation, outputSnippet } = body;

    if (!group || !evaluation) {
      return NextResponse.json({ error: 'group and evaluation required' }, { status: 400 });
    }

    ensureDir();

    const record = {
      id: Date.now().toString(36),
      group,
      workflow: workflow || 'manual',
      stepId: stepId || 'manual',
      action: action || 'evaluate',
      agent: agent || 'user',
      evaluation,
      outputSnippet: (outputSnippet || '').slice(0, 500),
      timestamp: new Date().toISOString(),
    };

    const logFile = path.join(LEARNING_DIR, `learning-${group}.jsonl`);
    fs.appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf-8');

    return NextResponse.json({ success: true, record });
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to add learning record: ${e.message}` }, { status: 500 });
  }
}
