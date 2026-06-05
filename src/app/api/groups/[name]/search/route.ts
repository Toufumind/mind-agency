import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from '@/lib/data-dir';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const q = request.nextUrl.searchParams.get('q')?.trim().toLowerCase();
  if (!q) return NextResponse.json({ results: [] });

  const chatDir = path.join(GROUPS_DIR, name, 'chat');
  if (!fs.existsSync(chatDir)) return NextResponse.json({ results: [] });

  const results: { from: string; date: string; body: string; file: string; matchAround: string }[] = [];
  const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.md')).sort().slice(-20);

  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(chatDir, f), 'utf-8');
      const blocks = raw.split(/\n(?=---\nfrom:)/);
      for (const block of blocks) {
        const m = block.trim().match(/^---\nfrom:\s*(.+?)\ndate:\s*(.+?)\n---\n\n([\s\S]*)/);
        if (!m) continue;
        const body = m[3].trim();
        if (!body.toLowerCase().includes(q)) continue;
        const ctxStart = Math.max(0, body.toLowerCase().indexOf(q) - 40);
        const matchAround = body.slice(ctxStart, ctxStart + 120);
        results.push({ from: m[1].trim(), date: m[2].trim(), body, file: f, matchAround });
      }
    } catch {}
  }

  return NextResponse.json({ results, total: results.length });
}
