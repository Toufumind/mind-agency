import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { GROUPS_DIR, AGENTS_DIR } from '@/lib/data-dir';

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

    // Create group structure
    fs.mkdirSync(path.join(gDir, 'Agents'), { recursive: true });
    fs.mkdirSync(path.join(gDir, 'chat'), { recursive: true });

    // Add initial members if provided
    const members: string[] = body.members || [];
    for (const member of members) {
      const memberName = (member || '').trim();
      if (!memberName) continue;
      const agentDir = path.join(AGENTS_DIR, memberName);
      if (!fs.existsSync(agentDir)) continue; // skip non-existent agents
      const memberLink = path.join(gDir, 'Agents', memberName);
      if (!fs.existsSync(memberLink)) {
        fs.mkdirSync(memberLink, { recursive: true });
      }
    }

    // Default TASK_SPEC
    fs.writeFileSync(path.join(gDir, 'TASK_SPEC.md'), `# ${name} 任务规则\n\n群组已创建，暂无任务规则。`, 'utf-8');

    // Default workflow.yaml
    fs.writeFileSync(path.join(gDir, 'workflow.yaml'), `name: ${name}-default\ndescription: "Default workflow for ${name}"\nsteps: []\n`, 'utf-8');

    return NextResponse.json({ success: true, name });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
