/**
 * Targeted agent poll — v0.4
 *
 * POST /api/poll/agent { agent: "Alice", group?: "dev" }
 * Polls ONLY the specified agent instead of all agents.
 * 10x faster than /api/poll when MCP Server knows which agent triggered.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pollAgent } from '@/lib/auto-respond';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: { agent?: string; group?: string };
  try { body = await request.json(); } catch { body = {}; }

  const agent = body.agent?.trim();
  if (!agent) {
    return NextResponse.json({ error: 'agent required' }, { status: 400 });
  }

  const result = await pollAgent(agent, body.group);
  return NextResponse.json({
    polled: 1,
    triggered: result.triggered ? 1 : 0,
    triggered_agents: result.triggered ? [agent] : [],
    results: [result],
  });
}
