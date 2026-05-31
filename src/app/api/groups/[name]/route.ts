import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/** GET: return group info — members, recent chat, chat files */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const groupDir = path.join(process.cwd(), 'Groups', name);

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

  return NextResponse.json({ group: name, members, messages, messageCount: messages.length });
}
