import { NextRequest, NextResponse } from 'next/server';
import { getAgency } from '@/lib/agency';

export async function GET(request: NextRequest) {
  try {
    const agent = request.nextUrl.searchParams.get('agent');
    const agency = getAgency();

    let groups;
    if (agent) {
      groups = agency.getGroupsByAgent(agent).map(g => g.name);
    } else {
      groups = agency.getGroups().map(g => g.name);
    }

    return NextResponse.json({ groups });
  } catch {
    return NextResponse.json({ groups: [] });
  }
}
