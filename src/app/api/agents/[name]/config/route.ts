import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { writeAudit } from '@/lib/audit';
import { AGENTS_DIR } from '@/lib/data-dir';
import { invalidateAgentCache } from '@/lib/chat';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });

  // CLAUDE.md read
  const { searchParams } = new URL(request.url);
  if (searchParams.get('file') === 'claude') {
    const claudePath = path.join(AGENTS_DIR, name, 'CLAUDE.md');
    if (!fs.existsSync(claudePath)) return NextResponse.json({ content: '' });
    return NextResponse.json({ content: fs.readFileSync(claudePath, 'utf-8') });
  }

  const cfgFile = path.join(AGENTS_DIR, name, 'config.json');
  if (!fs.existsSync(cfgFile)) {
    return NextResponse.json({
      autoRespondToEmail: false,
      autoProcessGroupInvites: false,
      notifyOnEmail: true,
      notifyOnGroupMention: true,
    });
  }
  try {
    const config = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
    // Filter out sensitive fields
    delete config.apiKey;
    return NextResponse.json(config);
  } catch {
    return NextResponse.json({ error: 'Invalid config' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });

  const agentDir = path.join(AGENTS_DIR, name);
  if (!fs.existsSync(agentDir)) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  try {
    const body = await request.json();

    // CLAUDE.md write
    if (body.claudeMd !== undefined) {
      const claudePath = path.join(agentDir, 'CLAUDE.md');
      fs.writeFileSync(claudePath, body.claudeMd, 'utf-8');
      invalidateAgentCache(name);
      writeAudit({ agent: name, action: 'claude.update', resource: `agent:${name}`, details: 'Updated CLAUDE.md' });
      return NextResponse.json({ success: true });
    }

    const cfgFile = path.join(agentDir, 'config.json');
    const existing = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf-8')) : {};
    const merged = { ...existing, ...body };
    const tmp = cfgFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8');
    fs.renameSync(tmp, cfgFile);
    invalidateAgentCache(name);

    writeAudit({
      agent: name,
      action: 'config.update',
      resource: `agent:${name}`,
      details: JSON.stringify(body),
    });

    return NextResponse.json(merged);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}
