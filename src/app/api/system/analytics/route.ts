/**
 * GET /api/system/analytics — aggregate observability data
 */

import { NextResponse } from 'next/server';
import { getActivityFeed, getCostAnalytics } from '@/lib/observability';

export async function GET() {
  const activity = getActivityFeed();
  const costs = getCostAnalytics();
  return NextResponse.json({ activity, costs });
}
