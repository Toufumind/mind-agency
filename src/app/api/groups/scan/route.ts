import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  const agent = request.nextUrl.searchParams.get('agent');
  const groupsDir = path.join(process.cwd(), 'Groups');
  if (!fs.existsSync(groupsDir)) return NextResponse.json({ groups: [] });

  const dirs = fs.readdirSync(groupsDir, { withFileTypes: true });
  const groups: string[] = [];

  for (const d of dirs) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    const agDir = path.join(groupsDir, d.name, 'Agents');
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
}
