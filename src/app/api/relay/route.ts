/**
 * POST /api/relay — AI API relay proxy
 * GET /api/relay — Relay usage logs
 *
 * Flow: Agent → Relay → RAG → AI Provider → Log → Return
 */

import { NextRequest, NextResponse } from 'next/server';
import { relay, readLogs, validateRelayKey } from '@/lib/relay';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agent, messages, model, maxTokens, relayKey } = body;

    if (!agent || !messages) {
      return NextResponse.json({ error: 'agent and messages required' }, { status: 400 });
    }

    // Authenticate: relayKey must match agent's key
    if (relayKey) {
      const authenticatedAgent = validateRelayKey(relayKey);
      if (!authenticatedAgent || authenticatedAgent !== agent) {
        return NextResponse.json({ error: 'Invalid relay key' }, { status: 401 });
      }
    }

    const result = await relay({ agent, messages, model, maxTokens });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[relay] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || undefined;
    const limit = parseInt(searchParams.get('limit') || '100');
    const logs = readLogs(date, limit);

    // Aggregate by agent
    const byAgent: Record<string, { calls: number; tokensIn: number; tokensOut: number; cost: number }> = {};
    let totalCost = 0;
    for (const log of logs) {
      if (!byAgent[log.agent]) byAgent[log.agent] = { calls: 0, tokensIn: 0, tokensOut: 0, cost: 0 };
      byAgent[log.agent].calls++;
      byAgent[log.agent].tokensIn += log.tokensIn;
      byAgent[log.agent].tokensOut += log.tokensOut;
      byAgent[log.agent].cost += log.cost;
      totalCost += log.cost;
    }

    return NextResponse.json({ logs: logs.slice(-50), byAgent, totalCost: +totalCost.toFixed(4), totalCalls: logs.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
