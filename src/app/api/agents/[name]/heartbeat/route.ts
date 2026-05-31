import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * Agent heartbeat — the frontend polls this every 30s.
 * If the agent's auto-respond cache was updated in the last 60s, it's "active"
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return NextResponse.json({ error: 'Invalid agent name' }, { status: 400 });
  }

  const agentDir = path.join(process.cwd(), 'Agents', name);

  // Check cache file timestamp
  let cacheTs = 0;
  let processedCount = 0;
  const cacheFile = path.join(agentDir, '.auto-respond-cache.json');
  if (fs.existsSync(cacheFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      cacheTs = data.updated ? new Date(data.updated).getTime() : 0;
      processedCount = (data.processed || []).length;
    } catch {}
  }

  // Also check chat session mtime (updated during active conversation)
  const sessionFile = path.join(agentDir, 'chat', 'session.json');
  let sessionTs = 0;
  if (fs.existsSync(sessionFile)) {
    try { sessionTs = fs.statSync(sessionFile).mtimeMs; } catch {}
  }

  const latestTs = Math.max(cacheTs, sessionTs);
  const isActive = Date.now() - latestTs < 120000; // 2 min window

  return NextResponse.json({
    active: isActive,
    lastAction: latestTs > 0 ? new Date(latestTs).toISOString() : null,
    processedCount,
  });
}
