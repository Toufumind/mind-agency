/**
 * Group Config API — load/save group settings.
 *
 * GET  /api/groups/{name}/config → return config
 * PUT  /api/groups/{name}/config → update config (owner/admin only)
 * POST /api/groups/{name}/manage  → invite/kick/set_admin (owner/admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgency } from '@/lib/agency';

// ── GET ──────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  const agency = getAgency();
  const proxy = agency.getGroup(name);

  if (!proxy.exists()) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  await proxy.loadConfig();
  await proxy.loadMembers();

  return NextResponse.json({
    ...proxy.config,
    members: proxy.members.map(m => m.name),
  });
}

// ── PUT — update group settings (owner/admins) ──────────

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  const agency = getAgency();
  const proxy = agency.getGroup(name);

  if (!proxy.exists()) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  let body: { by?: string; owner?: string; admins?: string[]; name?: string; description?: string; announcement?: { title: string; content: string; pinnedBy: string; pinnedAt?: number } | null };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const actor = (body.by || 'system').trim();

  await proxy.loadConfig();

  // Update simple fields
  if (body.admins !== undefined) proxy.config.admins = body.admins;
  if (body.name !== undefined) proxy.config.name = body.name;
  if (body.description !== undefined) proxy.config.description = body.description;

  // Announcement: null = remove, object = set
  if (body.announcement !== undefined) {
    if (body.announcement === null) {
      delete proxy.config.announcement;
    } else {
      proxy.config.announcement = {
        title: body.announcement.title || '',
        content: body.announcement.content || '',
        author: body.announcement.pinnedBy || actor,
        timestamp: body.announcement.pinnedAt || Date.now(),
      };
    }
  }

  await proxy.saveConfig();
  return NextResponse.json({ success: true, config: proxy.config });
}

// ── POST — membership management (invite/kick/set_admin) ──

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  let body: { action?: string; by?: string; agent?: string; admin?: boolean };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const actor = body.by?.trim() || 'system';
  const action = body.action || '';
  const target = body.agent?.trim();

  if (!target && action !== 'list') {
    return NextResponse.json({ error: 'agent required' }, { status: 400 });
  }

  const agency = getAgency();
  const proxy = agency.getGroup(name);

  if (!proxy.exists()) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  await proxy.loadConfig();
  await proxy.loadMembers();

  if (action === 'invite') {
    // Check if actor is admin
    if (!proxy.config.admins.includes(actor) && proxy.config.owner !== actor) {
      return NextResponse.json({ error: 'Not an admin of this group' }, { status: 403 });
    }
    const ok = await proxy.addMember(target!);
    if (!ok) return NextResponse.json({ error: 'Already a member or missing' }, { status: 409 });
    return NextResponse.json({ success: true, action: 'invite', agent: target });
  }

  if (action === 'kick') {
    // Check if actor is admin
    if (!proxy.config.admins.includes(actor) && proxy.config.owner !== actor) {
      return NextResponse.json({ error: 'Not an admin of this group' }, { status: 403 });
    }
    const ok = await proxy.removeMember(target!);
    if (!ok) return NextResponse.json({ error: 'Not a member' }, { status: 404 });
    return NextResponse.json({ success: true, action: 'kick', agent: target });
  }

  if (action === 'set_admin') {
    // Check if actor is owner
    if (proxy.config.owner !== actor) {
      return NextResponse.json({ error: 'Only the group owner can set admins' }, { status: 403 });
    }
    if (body.admin) {
      if (!proxy.config.admins.includes(target!)) proxy.config.admins.push(target!);
    } else {
      proxy.config.admins = proxy.config.admins.filter(a => a !== target);
    }
    await proxy.saveConfig();
    return NextResponse.json({ success: true, action: 'set_admin', agent: target, admin: body.admin });
  }

  if (action === 'transfer') {
    // Check if actor is owner
    if (proxy.config.owner !== actor) {
      return NextResponse.json({ error: 'Only the group owner can transfer ownership' }, { status: 403 });
    }
    proxy.config.owner = target!;
    proxy.config.admins = proxy.config.admins.filter(a => a !== target); // remove from admins if was admin
    await proxy.saveConfig();
    return NextResponse.json({ success: true, action: 'transfer', newOwner: target });
  }

  return NextResponse.json({ error: 'Unknown action. Use: invite, kick, set_admin, transfer' }, { status: 400 });
}
