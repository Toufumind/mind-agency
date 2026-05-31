import { NextRequest, NextResponse } from 'next/server';
import { getAgents, getStats } from '@/lib/agents';
import fs from 'fs';
import path from 'path';
import { writeAudit } from '@/lib/audit';

export async function GET() {
  const agents = getAgents();
  const stats = getStats();

  const agentList = agents.map(a => ({
    name: a.name,
    emailCount: a.emailCount,
    config: a.config,
  }));

  return NextResponse.json({ agents: agentList, stats });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name');
  if (!name) return NextResponse.json({ error: 'Agent name required' }, { status: 400 });
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });

  const agentDir = path.join(process.cwd(), 'Agents', name);
  if (!fs.existsSync(agentDir)) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  writeAudit({
    agent: name,
    action: 'agent.delete',
    resource: `agent:${name}`,
    details: 'Agent directory removed',
  });

  fs.rmSync(agentDir, { recursive: true, force: true });
  return NextResponse.json({ success: true });
}
