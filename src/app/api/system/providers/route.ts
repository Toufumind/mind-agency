/**
 * Provider Profiles API — CRUD + activate
 *
 * GET    /api/system/providers          — list all profiles
 * POST   /api/system/providers          — create new profile
 * PUT    /api/system/providers?id=xxx   — update profile
 * DELETE /api/system/providers?id=xxx   — delete profile
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  activateProfile,
  getActiveProfile,
  importFromSettings,
} from '@/lib/provider-profiles';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Auto-import from existing settings if no profiles exist
  const profiles = listProfiles();
  if (profiles.length === 0) {
    const imported = importFromSettings();
    if (imported) {
      return NextResponse.json({ profiles: listProfiles(), active: imported });
    }
  }
  return NextResponse.json({ profiles, active: getActiveProfile() });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, provider, apiKey, baseUrl, model } = body;

  if (!name || !apiKey || !baseUrl) {
    return NextResponse.json({ error: 'name, apiKey, baseUrl required' }, { status: 400 });
  }

  const profile = createProfile({
    name,
    provider: provider || 'claude',
    apiKey,
    baseUrl,
    model: model || 'claude-sonnet-4-20250514',
  });

  return NextResponse.json({ profile }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const action = searchParams.get('action');

  // Activate profile
  if (action === 'activate' && id) {
    const ok = activateProfile(id);
    if (!ok) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    return NextResponse.json({ success: true, active: getActiveProfile() });
  }

  // Update profile
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const body = await request.json();
  const profile = updateProfile(id, body);
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  return NextResponse.json({ profile });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const ok = deleteProfile(id);
  if (!ok) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
