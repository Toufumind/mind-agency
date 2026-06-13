/**
 * POST /api/economy/deposit — deposit tokens to agent
 */
import { NextRequest, NextResponse } from 'next/server';
import { deposit } from '@/lib/token-economy';

export async function POST(request: NextRequest) {
  try {
    const { agent, amount, from, reason } = await request.json();
    if (!agent || !amount) return NextResponse.json({ error: 'agent and amount required' }, { status: 400 });
    const balance = deposit(agent, Number(amount), reason || 'deposit');
    return NextResponse.json({ ok: true, balance });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
