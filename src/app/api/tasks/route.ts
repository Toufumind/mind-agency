import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MIND_DIR } from '@/lib/data-dir';

const TASKS_DIR = path.join(MIND_DIR, 'open-tasks');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// GET /api/tasks?group=X — list tasks for a group
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const group = searchParams.get('group');

  if (!group) {
    // List all groups with tasks
    ensureDir(TASKS_DIR);
    const groups = fs.readdirSync(TASKS_DIR).filter(d => {
      try { return fs.statSync(path.join(TASKS_DIR, d)).isDirectory(); }
      catch { return false; }
    });
    return NextResponse.json({ groups });
  }

  const groupDir = path.join(TASKS_DIR, group);
  if (!fs.existsSync(groupDir)) {
    return NextResponse.json({ tasks: [] });
  }

  const files = fs.readdirSync(groupDir).filter(f => f.endsWith('.json'));
  const tasks = files.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(groupDir, f), 'utf-8')); }
    catch { return null; }
  }).filter(Boolean);

  return NextResponse.json({ tasks });
}

// POST /api/tasks — create a task (called by MCP tool or API)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { group, id, title, description, reward, requiredSkills, maxClaims, postedBy } = body;

    if (!group || !id || !title || !description) {
      return NextResponse.json({ error: 'group, id, title, description required' }, { status: 400 });
    }

    const task = {
      id, group, title, description,
      reward: reward || 0,
      requiredSkills: requiredSkills || [],
      maxClaims: maxClaims || 1,
      postedBy: postedBy || 'system',
      claims: [],
      status: 'open',
      createdAt: Date.now(),
    };

    ensureDir(TASKS_DIR);
    const taskDir = path.join(TASKS_DIR, group);
    ensureDir(taskDir);
    fs.writeFileSync(path.join(taskDir, `${id}.json`), JSON.stringify(task, null, 2));

    return NextResponse.json({ success: true, task });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PUT /api/tasks — update a task (claim, select, complete)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { group, taskId, action, agent, message } = body;

    if (!group || !taskId || !action) {
      return NextResponse.json({ error: 'group, taskId, action required' }, { status: 400 });
    }

    const taskDir = path.join(TASKS_DIR, group);
    const taskPath = path.join(taskDir, `${taskId}.json`);
    if (!fs.existsSync(taskPath)) {
      return NextResponse.json({ error: 'task not found' }, { status: 404 });
    }

    const task = JSON.parse(fs.readFileSync(taskPath, 'utf-8'));

    if (action === 'claim') {
      if (task.status !== 'open') return NextResponse.json({ error: 'task not open' }, { status: 400 });
      if (!agent) return NextResponse.json({ error: 'agent required' }, { status: 400 });
      if (task.claims.find((c: any) => c.agent === agent)) return NextResponse.json({ error: 'already claimed' }, { status: 400 });
      task.claims.push({ agent, message: message || '', claimedAt: Date.now() });
    } else if (action === 'select') {
      if (!agent) return NextResponse.json({ error: 'agent required' }, { status: 400 });
      const claim = task.claims.find((c: any) => c.agent === agent);
      if (!claim) return NextResponse.json({ error: 'agent did not claim' }, { status: 400 });
      task.status = 'assigned';
      task.assignedTo = agent;
    } else if (action === 'complete') {
      task.status = 'completed';
      task.completedAt = Date.now();
    } else if (action === 'cancel') {
      task.status = 'cancelled';
    }

    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
    return NextResponse.json({ success: true, task });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
