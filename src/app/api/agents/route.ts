import { NextRequest, NextResponse } from 'next/server';
import { getAgentRegistry } from '@/lib/agent-registry';
import { writeAudit } from '@/lib/audit';
import { broadcastWs } from '@/lib/ws-embedded';

export async function GET() {
  try {
    const registry = getAgentRegistry();
    const agents = registry.getAll();
    const agentList = await Promise.all(agents.map(async (proxy) => {
      await proxy.loadConfig();
      return {
        name: proxy.name,
        config: proxy.config,
        activity: proxy.activity,
      };
    }));
    return NextResponse.json({ agents: agentList });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to load agents' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    if (!name) return NextResponse.json({ error: 'Agent name required' }, { status: 400 });
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });

    const registry = getAgentRegistry();
    const proxy = registry.get(name);
    if (!proxy || !proxy.exists()) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    writeAudit({ agent: name, action: 'agent.delete', resource: `agent:${name}`, details: 'Agent directory removed' });
    registry.remove(name); // This will destroy the proxy and clean up

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 });
  }
}

// Create new agent
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = (body.name || '').trim();
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return NextResponse.json({ error: 'Invalid agent name' }, { status: 400 });
    }

    const registry = getAgentRegistry();
    const existingProxy = registry.get(name);
    if (existingProxy && existingProxy.exists()) {
      return NextResponse.json({ error: 'Agent already exists' }, { status: 409 });
    }

    // Create agent via proxy
    const proxy = registry.getOrCreate(name);
    await proxy.loadConfig();

    // Set config from request body
    proxy.config.roles = body.roles || ['member'];
    proxy.config.permissions = body.permissions || { canCreateGroup: false, canDeleteGroup: false, canDeploy: false };
    proxy.config.autoRespondToEmail = body.autoRespondToEmail ?? false;
    proxy.config.autoProcessGroupInvites = body.autoProcessGroupInvites ?? false;
    if (body.allowedTools) proxy.config.allowedTools = body.allowedTools;
    if (body.disallowedTools) proxy.config.disallowedTools = body.disallowedTools;
    if (body.permissionMode) proxy.config.permissionMode = body.permissionMode;
    if (body.maxTurns) proxy.config.maxTurns = body.maxTurns;

    await proxy.saveConfig();

    writeAudit({ agent: name, action: 'agent.create', resource: `agent:${name}`, details: `roles: ${proxy.config.roles.join(',')}` });

    broadcastWs('sidebar_refresh', {});
    return NextResponse.json({ success: true, name, config: proxy.config });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
