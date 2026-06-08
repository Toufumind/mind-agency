import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from '@/lib/data-dir';

export async function GET(request: NextRequest) {
  try {
    const agent = request.nextUrl.searchParams.get('agent');
    if (!fs.existsSync(GROUPS_DIR)) return NextResponse.json({ groups: [] });

    const dirs = fs.readdirSync(GROUPS_DIR, { withFileTypes: true });
    const groups: string[] = [];

    for (const d of dirs) {
      if (!d.isDirectory() || d.name.startsWith('.')) continue;
      const agDir = path.join(GROUPS_DIR, d.name, 'Agents');
      if (!fs.existsSync(agDir)) continue;

      // No agent specified → return all groups
      if (!agent) {
        groups.push(d.name);
        continue;
      }

      // Filter by agent membership
      const entries = fs.readdirSync(agDir, { withFileTypes: true });
      if (entries.some(e => e.isDirectory() && e.name.toLowerCase() === agent.toLowerCase())) {
        groups.push(d.name);
      }
    }

    return NextResponse.json({ groups });
  } catch {
    return NextResponse.json({ groups: [] });
  }
}
