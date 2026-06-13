/**
 * POST /api/economy/transfer — transfer tokens between agents
 */
import { NextRequest, NextResponse } from 'next/server';
import { transfer } from '@/lib/token-economy';

export async function POST(request: NextRequest) {
  try {
    const { from, to, amount, reason } = await request.json();
    if (!from || !to || !amount) return NextResponse.json({ error: 'from, to, amount required' }, { status: 400 });
    const ok = transfer(from, to, Number(amount), reason || 'transfer');
    return NextResponse.json({ ok });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
