/**
 * GET /api/system/pending — aggregate pending approvals (consensus + workflow)
 */
import { NextResponse } from 'next/server';
import { getAgency } from '@/lib/agency';
import http from 'http';

export async function GET() {
  const agency = getAgency();
  const items: { type: string; id: string; group: string; requestedBy: string; description: string; createdAt: number }[] = [];

  // Get pending approvals via SystemProxy
  const pendingApprovals = await agency.system.getPendingApprovals();
  for (const approval of pendingApprovals) {
    items.push({
      type: 'workflow',
      id: approval.approvalId,
      group: approval.group,
      requestedBy: approval.agent,
      description: approval.prompt,
      createdAt: Date.now(),
    });
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
