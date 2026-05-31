/**
 * POST /api/system/token — report token usage from agents
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const TOKEN_FILE = path.join(process.cwd(), '.audit', 'tokens.jsonl');
const MAX_RECORDS = 500;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const record = {
      agent: body.agent || 'unknown',
      tokensIn: body.tokensIn || 0,
      tokensOut: body.tokensOut || 0,
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
