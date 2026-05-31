import { NextResponse } from 'next/server';
import { pollAllAgents } from '@/lib/auto-respond';

export const dynamic = 'force-dynamic';

export async function POST() {
  const startMs = Date.now();
  const results = await pollAllAgents();
  const triggered = results.filter(r => r.triggered);
  const duration = Date.now() - startMs;

  return NextResponse.json({
    polled: results.length,
    triggered: triggered.length,
    duration_ms: duration,
    triggered_agents: triggered.map(r => r.agent),
    results: results.map(r => ({
      agent: r.agent,
      active: r.triggered,
    })),
  });
}
