import { NextResponse } from 'next/server';
import { pollAllAgents } from '@/lib/auto-respond';
import { startScheduler } from '@/lib/scheduler';
export const dynamic = 'force-dynamic';
let started = false;
export async function POST() {
  if (!started) { started = true; startScheduler(); }
  const r = await pollAllAgents();
  const triggered = r.filter(t => t.triggered);
  return NextResponse.json({
    polled: r.length, triggered: triggered.length,
    triggered_agents: triggered.map(t => t.agent),
    results: r.map(t => ({ agent: t.agent, active: t.triggered })),
  });
}
