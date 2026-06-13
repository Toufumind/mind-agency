/**
 * GET /api/economy/leaderboard — get token leaderboard
 */
import { NextResponse } from 'next/server';
import { getLeaderboard } from '@/lib/token-economy';

export async function GET() {
  try {
    const leaderboard = getLeaderboard();
    return NextResponse.json({ leaderboard });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
