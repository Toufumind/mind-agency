import { NextResponse } from 'next/server';
import { getAgency } from '@/lib/agency';
import fs from 'fs';
import path from 'path';

/** GET /api/system/export — download a full JSON backup of all Mind Agency data */
export async function GET() {
  try {
    const agency = getAgency();
    const manifest: Record<string, any> = { exportedAt: new Date().toISOString(), agents: {}, groups: {} };

    // Agents
    for (const proxy of agency.getAgents()) {
      await proxy.loadConfig();
      manifest.agents[proxy.name] = { config: proxy.config };
    }

    // Groups
    for (const proxy of agency.getGroups()) {
      await proxy.loadConfig();
      await proxy.loadMembers();
      const workflow = await proxy.getWorkflow();
      const messages = await proxy.getMessages(1000);

      manifest.groups[proxy.name] = {
        config: proxy.config,
        members: proxy.members.map(m => m.name),
        workflow,
        messages,
      };
    }

    // Token usage
    await agency.system.loadTokenRecords();
    manifest.tokens = agency.system.tokenRecords;

    const json = JSON.stringify(manifest, null, 2);
    return new NextResponse(json, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="mind-agency-backup-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
