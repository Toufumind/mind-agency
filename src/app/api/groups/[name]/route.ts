import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from '@/lib/data-dir';
import { broadcastWs } from '@/lib/ws-embedded';

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const groupDir = path.join(GROUPS_DIR, name);

  if (!fs.existsSync(groupDir)) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

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
    const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.md')).sort().slice(-5); // last 5 days
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

  return NextResponse.json({ group: name, members, messages, messageCount: messages.length, info });
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
