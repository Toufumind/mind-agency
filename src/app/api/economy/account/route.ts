/**
 * GET /api/economy/account?agent=<name> — get agent token account
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAgentAccount } from '@/lib/token-economy';

export async function GET(request: NextRequest) {
  const agent = request.nextUrl.searchParams.get('agent');
  if (!agent) return NextResponse.json({ error: 'agent required' }, { status: 400 });
  try {
    const account = getAgentAccount(agent);
    return NextResponse.json({ account });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
