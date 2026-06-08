import { NextRequest, NextResponse } from 'next/server';
import { readAuditLogs, readAgentAuditLogs } from '@/lib/audit';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100'), 1), 1000);
    const agent = searchParams.get('agent');

    const logs = agent
      ? readAgentAuditLogs(agent, limit)
      : readAuditLogs(limit);

    return NextResponse.json({ logs, count: logs.length });
  } catch {
    return NextResponse.json({ error: 'Failed to load audit logs' }, { status: 500 });
  }
}
