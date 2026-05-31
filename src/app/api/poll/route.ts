import { NextResponse } from 'next/server';
import { pollAllAgents } from '@/lib/auto-respond';

export const dynamic = 'force-dynamic';

export async function POST() {
  const results = await pollAllAgents();
  const triggered = results.filter(r => r.triggered);
  return NextResponse.json({
    polled: results.length,
    triggered: triggered.length,
    agents: triggered.map(r => r.agent),
    results,
  });
}
