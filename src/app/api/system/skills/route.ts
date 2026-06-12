/**
 * Skills API — List, search, install, uninstall, enable/disable
 *
 * GET    /api/system/skills              — list installed skills
 * POST   /api/system/skills              — install skill from GitHub
 * DELETE /api/system/skills?id=xxx       — uninstall skill
 * PUT    /api/system/skills              — enable/disable skill for agent
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getInstalledSkills,
  installSkill,
  uninstallSkill,
  searchSkills,
  enableSkill,
  disableSkill,
  getEnabledSkills,
  setEnabledSkills,
  isSkillEnabled,
} from '@/lib/skills';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const agent = searchParams.get('agent');

  // Search mode
  if (query) {
    const results = await searchSkills(query);
    return NextResponse.json({ results });
  }

  // List installed with agent enable status
  const skills = getInstalledSkills();
  if (agent) {
    const enabledSkills = getEnabledSkills(agent);
    const skillsWithStatus = skills.map(s => ({
      ...s,
      enabled: enabledSkills.includes(s.name),
    }));
    return NextResponse.json({ skills: skillsWithStatus });
  }

  return NextResponse.json({ skills });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { repo, path: repoPath, agent, skillName, action } = body;

  // Enable/disable skill for agent
  if (action === 'enable' && agent && skillName) {
    const ok = enableSkill(agent, skillName);
    return NextResponse.json({ success: ok });
  }

  if (action === 'disable' && agent && skillName) {
    const ok = disableSkill(agent, skillName);
    return NextResponse.json({ success: ok });
  }

  if (action === 'set_enabled' && agent && Array.isArray(body.skillNames)) {
    setEnabledSkills(agent, body.skillNames);
    return NextResponse.json({ success: true });
  }

  // Install skill from GitHub
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
