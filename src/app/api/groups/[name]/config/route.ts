/**
 * Group Config API — load/save group settings.
 *
 * GET  /api/groups/{name}/config → return config
 * PUT  /api/groups/{name}/config → update config (owner/admin only)
 * POST /api/groups/{name}/manage  → invite/kick/set_admin (owner/admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from '@/lib/data-dir';
import {
  loadGroupConfig, saveGroupConfig, ensureGroupConfig,
  isGroupAdmin, isGroupOwner, addMember, kickMember,
  type GroupConfig,
} from '@/lib/group-config';

// ── GET ──────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const groupDir = path.join(GROUPS_DIR, name);
  if (!fs.existsSync(groupDir)) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  const config = loadGroupConfig(name) || ensureGroupConfig(name, 'unknown');
  const members = getGroupMembers(name);

  return NextResponse.json({ ...config, members });
}

// ── PUT — update group settings (owner/admins) ──────────

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const groupDir = path.join(GROUPS_DIR, name);
  if (!fs.existsSync(groupDir)) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  let body: { by?: string; owner?: string; admins?: string[]; name?: string; description?: string; announcement?: { title: string; content: string; pinnedBy: string; pinnedAt?: number } | null };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const actor = (body.by || 'system').trim();

  const config = loadGroupConfig(name) || ensureGroupConfig(name, actor);

  // Update simple fields
  if (body.admins !== undefined) config.admins = body.admins;
  if (body.name !== undefined) config.name = body.name;
  if (body.description !== undefined) config.description = body.description;

  // Announcement: null = remove, object = set
  if (body.announcement !== undefined) {
    if (body.announcement === null) {
      delete config.announcement;
    } else {
      config.announcement = {
        title: body.announcement.title || '',
        content: body.announcement.content || '',
        pinnedBy: body.announcement.pinnedBy || actor,
        pinnedAt: body.announcement.pinnedAt || Date.now(),
      };
    }
  }

  saveGroupConfig(name, config);
  return NextResponse.json({ success: true, config });
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

  if (action === 'invite') {
    if (!isGroupAdmin(name, actor)) {
      return NextResponse.json({ error: 'Not an admin of this group' }, { status: 403 });
    }
    const ok = addMember(name, target!);
    if (!ok) return NextResponse.json({ error: 'Already a member or missing' }, { status: 409 });
    return NextResponse.json({ success: true, action: 'invite', agent: target });
  }

  if (action === 'kick') {
    if (!isGroupAdmin(name, actor)) {
      return NextResponse.json({ error: 'Not an admin of this group' }, { status: 403 });
    }
    const ok = kickMember(name, target!);
    if (!ok) return NextResponse.json({ error: 'Not a member' }, { status: 404 });
    return NextResponse.json({ success: true, action: 'kick', agent: target });
  }

  if (action === 'set_admin') {
    if (!isGroupOwner(name, actor)) {
      return NextResponse.json({ error: 'Only the group owner can set admins' }, { status: 403 });
    }
    const config = loadGroupConfig(name);
    if (!config) return NextResponse.json({ error: 'Group config not found' }, { status: 404 });
    if (body.admin) {
      if (!config.admins.includes(target!)) config.admins.push(target!);
    } else {
      config.admins = config.admins.filter(a => a !== target);
    }
    saveGroupConfig(name, config);
    return NextResponse.json({ success: true, action: 'set_admin', agent: target, admin: body.admin });
  }

  if (action === 'transfer') {
    if (!isGroupOwner(name, actor)) {
      return NextResponse.json({ error: 'Only the group owner can transfer ownership' }, { status: 403 });
    }
    const config = loadGroupConfig(name);
    if (!config) return NextResponse.json({ error: 'Group config not found' }, { status: 404 });
    config.owner = target!;
    config.admins = config.admins.filter(a => a !== target); // remove from admins if was admin
    saveGroupConfig(name, config);
    return NextResponse.json({ success: true, action: 'transfer', newOwner: target });
  }

  return NextResponse.json({ error: 'Unknown action. Use: invite, kick, set_admin, transfer' }, { status: 400 });
}

// ── Helpers ──────────────────────────────────────────────

function getGroupMembers(group: string): string[] {
  const agentsDir = path.join(GROUPS_DIR, group, 'Agents');
  if (!fs.existsSync(agentsDir)) return [];
  return fs.readdirSync(agentsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
}
