import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  const agent = request.nextUrl.searchParams.get('agent');
  if (!agent) return NextResponse.json({ groups: [] });

  const groupsDir = path.join(process.cwd(), 'Groups');
  if (!fs.existsSync(groupsDir)) return NextResponse.json({ groups: [] });

  const dirs = fs.readdirSync(groupsDir, { withFileTypes: true });
  const groups: string[] = [];

  for (const d of dirs) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    // Check both exact case and case-insensitive
    const agDir = path.join(groupsDir, d.name, 'Agents');
    if (!fs.existsSync(agDir)) continue;
    const entries = fs.readdirSync(agDir, { withFileTypes: true });
    if (entries.some(e => e.isDirectory() && e.name.toLowerCase() === agent.toLowerCase())) {
      groups.push(d.name);
    }
  }

  return NextResponse.json({ groups });
}
