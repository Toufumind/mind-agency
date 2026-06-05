import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from '@/lib/data-dir';

// ── POST /api/groups — create a new group ────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = (body.name || '').trim();
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return NextResponse.json({ error: 'Invalid group name' }, { status: 400 });
    }

    const gDir = path.join(GROUPS_DIR, name);
    if (fs.existsSync(gDir)) {
      return NextResponse.json({ error: 'Group already exists' }, { status: 409 });
    }

    // Create group structure (no members — agents join via MCP group_join)
    fs.mkdirSync(path.join(gDir, 'Agents'), { recursive: true });
    fs.mkdirSync(path.join(gDir, 'chat'), { recursive: true });

    // Default TASK_SPEC
    fs.writeFileSync(path.join(gDir, 'TASK_SPEC.md'), `# ${name} 任务规则\n\n群组已创建，暂无任务规则。`, 'utf-8');

    // Default workflow.yaml
    fs.writeFileSync(path.join(gDir, 'workflow.yaml'), `name: ${name}-default\ndescription: "Default workflow for ${name}"\nsteps: []\n`, 'utf-8');

    return NextResponse.json({ success: true, name });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
