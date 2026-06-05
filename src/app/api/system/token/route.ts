/**
 * POST /api/system/token — report token usage from agents
 * GET  /api/system/token — read recent usage summary
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { AUDIT_DIR } from '@/lib/data-dir';

const TOKEN_FILE = path.join(AUDIT_DIR, 'tokens.jsonl');
const MAX_RECORDS = 5000;

export async function GET() {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return NextResponse.json({ records: [], summary: { totalTokens: 0, totalCost: 0 } });

    const records = fs.readFileSync(TOKEN_FILE, 'utf-8')
      .split('\n').filter(Boolean)
      .map(line => JSON.parse(line))
      .slice(-200);

    const byAgent: Record<string, { tokensIn: number; tokensOut: number; cost: number; calls: number }> = {};
    let totalTokens = 0, totalCost = 0;

    for (const r of records) {
      totalTokens += (r.tokensIn || 0) + (r.tokensOut || 0);
      totalCost += (r.cost || 0);
      if (!byAgent[r.agent]) byAgent[r.agent] = { tokensIn: 0, tokensOut: 0, cost: 0, calls: 0 };
      byAgent[r.agent].tokensIn += (r.tokensIn || 0);
      byAgent[r.agent].tokensOut += (r.tokensOut || 0);
      byAgent[r.agent].cost += (r.cost || 0);
      byAgent[r.agent].calls++;
    }

    return NextResponse.json({
      records: records.slice(-50),
      summary: { totalTokens, totalCost: +totalCost.toFixed(4), byAgent },
    });
  } catch {
    return NextResponse.json({ records: [], summary: { totalTokens: 0, totalCost: 0 } });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const record = {
      agent: body.agent || 'unknown',
      tokensIn: body.tokensIn || 0,
      tokensOut: body.tokensOut || 0,
      cost: body.cost || 0,
      timestamp: Date.now(),
      model: body.model || 'unknown',
    };
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(TOKEN_FILE, JSON.stringify(record) + '\n', 'utf-8');
    // Rotate
    if (fs.existsSync(TOKEN_FILE)) {
      const lines = fs.readFileSync(TOKEN_FILE, 'utf-8').split('\n').filter(Boolean);
      if (lines.length > MAX_RECORDS) {
        fs.writeFileSync(TOKEN_FILE, lines.slice(-MAX_RECORDS / 2).join('\n') + '\n', 'utf-8');
      }
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
}
