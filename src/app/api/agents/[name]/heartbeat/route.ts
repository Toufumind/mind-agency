import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { AGENTS_DIR, GROUPS_DIR } from '@/lib/data-dir';
import { getActivity } from '@/lib/agent-activity';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return NextResponse.json({ error: 'Invalid agent name' }, { status: 400 });
  }

  const agentDir = path.join(AGENTS_DIR, name);
  let latestTs = 0;

  // Check .auto-respond-cache.json
  const cacheFile = path.join(agentDir, '.auto-respond-cache.json');
  if (fs.existsSync(cacheFile)) {
    try {
      const d = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (d.updated) latestTs = Math.max(latestTs, new Date(d.updated).getTime());
    } catch {}
  }

  // Check chat session mtime
  const sessionFile = path.join(agentDir, 'chat', 'session.json');
  if (fs.existsSync(sessionFile)) {
    try { latestTs = Math.max(latestTs, fs.statSync(sessionFile).mtimeMs); } catch {}
  }

  // Check pending invitations
  if (fs.existsSync(GROUPS_DIR)) {
    for (const g of fs.readdirSync(GROUPS_DIR, { withFileTypes: true })) {
      if (!g.isDirectory() || g.name.startsWith('.')) continue;
      const invFile = path.join(GROUPS_DIR, g.name, '.invitations', `${name.toLowerCase()}.json`);
      if (fs.existsSync(invFile)) {
        try { latestTs = Math.max(latestTs, fs.statSync(invFile).mtimeMs); } catch {}
      }
    }
  }

  // Check pending consensus/workflow approvals
  // (agent has pending decide calls)
  if (fs.existsSync(GROUPS_DIR)) {
    for (const g of fs.readdirSync(GROUPS_DIR, { withFileTypes: true })) {
      if (!g.isDirectory() || g.name.startsWith('.')) continue;
      const decisionsDir = path.join(GROUPS_DIR, g.name, '.decisions');
      if (!fs.existsSync(decisionsDir)) continue;
      for (const f of fs.readdirSync(decisionsDir)) {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(decisionsDir, f), 'utf-8'));
          if (d.agent?.toLowerCase() === name.toLowerCase()) {
            latestTs = Math.max(latestTs, fs.statSync(path.join(decisionsDir, f)).mtimeMs);
          }
        } catch {}
      }
    }
  }

  const isActive = Date.now() - latestTs < 120000; // 2 min window

  // Include in-memory activity state (what the agent is currently doing)
  const activity = getActivity(name);

  return NextResponse.json({
    active: isActive,
    lastAction: latestTs > 0 ? new Date(latestTs).toISOString() : null,
    status: activity.status,
    detail: activity.detail,
  });
}
