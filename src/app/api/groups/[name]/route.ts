import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from '@/lib/data-dir';
import { broadcastWs } from '@/lib/ws-embedded';

// Simple cache for group API responses (10s TTL for fresh chat data)
const groupApiCache = new Map<string, { data: any; ts: number }>();
const GROUP_API_TTL = 10_000; // 10s

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  // Check cache first (skip if ?nocache=1)
  const noCache = request.nextUrl.searchParams.get('nocache') === '1';
  if (!noCache) {
    const cached = groupApiCache.get(name);
    if (cached && (Date.now() - cached.ts) < GROUP_API_TTL) {
      return NextResponse.json(cached.data);
    }
  }

  const groupDir = path.join(GROUPS_DIR, name);

  if (!fs.existsSync(groupDir)) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  // Parse limit from query params (default: 20)
  const limit = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('limit') || '20', 10) || 20, 1), 200);

  // Members
  const agentsDir = path.join(groupDir, 'Agents');
  const members: string[] = [];
  if (fs.existsSync(agentsDir)) {
    for (const e of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (e.isDirectory()) members.push(e.name);
    }
  }

  // Chat messages
  interface ChatEntry { from: string; date: string; body: string; file: string; }
  const messages: ChatEntry[] = [];
  const chatDir = path.join(groupDir, 'chat');
  if (fs.existsSync(chatDir)) {
    const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.md')).sort().slice(-limit);
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(chatDir, f), 'utf-8');
        const blocks = raw.split(/\n(?=---\nfrom:)/);
        for (const block of blocks) {
          const m = block.trim().match(/^---\nfrom:\s*(.+?)\ndate:\s*(.+?)\n---\n\n([\s\S]*)/);
          if (m) messages.push({ from: m[1].trim(), date: m[2].trim(), body: m[3].trim(), file: f });
        }
      } catch {}
    }
  }

  // Group info from config
  const { getGroupInfo } = await import('@/lib/group-config');
  const info = getGroupInfo(name);

  const result = { group: name, members, messages, messageCount: messages.length, info };

  // Cache the result
  groupApiCache.set(name, { data: result, ts: Date.now() });

  return NextResponse.json(result);
}

/** Invalidate group API cache (called after writes) */
export function invalidateGroupApiCache(groupName?: string): void {
  if (groupName) groupApiCache.delete(groupName);
  else groupApiCache.clear();
}

// ── POST /api/groups/[name] — send a message directly to group chat ──

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const groupDir = path.join(GROUPS_DIR, name);
  if (!fs.existsSync(groupDir)) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  let from = 'system';
  let message = '';
  try {
    const body = await request.json();
    from = (body.from || 'system').trim();
    message = (body.message || '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!message) return NextResponse.json({ error: 'Empty message' }, { status: 400 });
  if (!/^[a-zA-Z0-9_-]+$/.test(from) && from !== 'system') {
    return NextResponse.json({ error: 'Invalid sender name' }, { status: 400 });
  }

  const { writeChatMessage } = await import('@/lib/atomic');
  writeChatMessage(groupDir, from, message);

  // Push to all connected clients in real time
  broadcastWs('group_message', { group: name, from, message, date: new Date().toISOString() });

  return NextResponse.json({ success: true, from, date: new Date().toISOString() });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const groupDir = path.join(GROUPS_DIR, name);
  if (!fs.existsSync(groupDir)) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }
  fs.rmSync(groupDir, { recursive: true, force: true });
  return NextResponse.json({ success: true });
}
