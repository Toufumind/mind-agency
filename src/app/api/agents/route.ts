import { NextResponse } from 'next/server';
import { getAgents, getStats } from '@/lib/agents';

export async function GET() {
  const agents = getAgents();
  const stats = getStats();

  // 去掉 rulesContent 减少传输量
  const agentList = agents.map(a => ({
    name: a.name,
    emailCount: a.emailCount,
  }));

  return NextResponse.json({
    agents: agentList,
    stats,
  });
}
