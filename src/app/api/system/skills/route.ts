/**
 * Skills API — List, search, install, uninstall
 *
 * GET    /api/system/skills              — list installed skills
 * POST   /api/system/skills              — install skill from GitHub
 * DELETE /api/system/skills?id=xxx       — uninstall skill
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getInstalledSkills,
  installSkill,
  uninstallSkill,
  searchSkills,
} from '@/lib/skills';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  // Search mode
  if (query) {
    const results = await searchSkills(query);
    return NextResponse.json({ results });
  }

  // List installed
  const skills = getInstalledSkills();
  return NextResponse.json({ skills });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { repo, path: repoPath } = body;

  if (!repo) {
    return NextResponse.json({ error: 'repo required (e.g. "owner/repo")' }, { status: 400 });
  }

  try {
    const skill = await installSkill(repo, repoPath);
    return NextResponse.json({ skill }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const ok = uninstallSkill(id);
  if (!ok) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
