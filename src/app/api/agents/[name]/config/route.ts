import { NextRequest, NextResponse } from 'next/server';
import { getAgentRegistry } from '@/lib/agent-registry';
import { writeAudit } from '@/lib/audit';
import fs from 'fs';
import path from 'path';
import { AGENTS_DIR } from '@/lib/data-dir';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });

  const registry = getAgentRegistry();
  const proxy = registry.getOrCreate(name);
  await proxy.loadConfig();

  // CLAUDE.md read
  const { searchParams } = new URL(request.url);
  if (searchParams.get('file') === 'claude') {
    // Read CLAUDE.md via proxy's internal method
    const claudePath = path.join(AGENTS_DIR, name, 'CLAUDE.md');
    if (!fs.existsSync(claudePath)) return NextResponse.json({ content: '' });
    return NextResponse.json({ content: fs.readFileSync(claudePath, 'utf-8') });
  }

  // Filter out sensitive fields
  const config = { ...proxy.config };
  delete (config as any).apiKey;
  return NextResponse.json(config);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });

  const registry = getAgentRegistry();
  const proxy = registry.getOrCreate(name);
  if (!proxy.exists()) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  try {
    const body = await request.json();

    // CLAUDE.md write
    if (body.claudeMd !== undefined) {
      const agentDir = path.join(AGENTS_DIR, name);
      if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });
      const claudePath = path.join(agentDir, 'CLAUDE.md');
      fs.writeFileSync(claudePath, body.claudeMd, 'utf-8');
      proxy.invalidateCache();
      writeAudit({ agent: name, action: 'claude.update', resource: `agent:${name}`, details: 'Updated CLAUDE.md' });
      return NextResponse.json({ success: true });
    }

    // Update config via proxy
    await proxy.loadConfig();
    Object.assign(proxy.config, body);
    await proxy.saveConfig();
    proxy.invalidateCache();

    writeAudit({
      agent: name,
      action: 'config.update',
      resource: `agent:${name}`,
      details: JSON.stringify(body),
    });

    return NextResponse.json(proxy.config);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}
