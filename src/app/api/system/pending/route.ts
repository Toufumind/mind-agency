/**
 * GET /api/system/pending — aggregate pending approvals (consensus + workflow)
 */
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from '@/lib/data-dir';
import http from 'http';

export async function GET() {
  const items: { type: string; id: string; group: string; requestedBy: string; description: string; createdAt: number }[] = [];

  // Scan consensus requests
  if (fs.existsSync(GROUPS_DIR)) {
    for (const g of fs.readdirSync(GROUPS_DIR, { withFileTypes: true })) {
      if (!g.isDirectory() || g.name.startsWith('.')) continue;
      const dir = path.join(GROUPS_DIR, g.name, '.consensus');
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
          if (d.status === 'pending') {
            items.push({
              type: 'consensus',
              id: d.id,
              group: g.name,
              requestedBy: d.requestedBy,
              description: d.description,
              createdAt: d.createdAt,
            });
          }
        } catch {}
      }
    }
  }

  // Fetch workflow approvals via HTTP (to WS server)
  try {
    const wsPort = parseInt(process.env.WS_PORT || '3001', 10);
    const pending = await new Promise<any[]>((resolve) => {
      const req = http.get(`http://127.0.0.1:${wsPort}/workflows/approvals`, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => { try { const d = JSON.parse(body); resolve(d.pending || []); } catch { resolve([]); } });
      });
      req.on('error', () => resolve([]));
      req.setTimeout(3000, () => { req.destroy(); resolve([]); });
    });
    for (const wf of pending) {
      items.push({
        type: 'workflow',
        id: wf.id || wf.approvalId,
        group: wf.group || '',
        requestedBy: wf.agent || '',
        description: wf.description || wf.title || '',
        createdAt: wf.createdAt || Date.now(),
      });
    }
  } catch {}

  items.sort((a, b) => b.createdAt - a.createdAt);

  return NextResponse.json({ items, count: items.length });
}
