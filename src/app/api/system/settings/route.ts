/**
 * GET  /api/system/settings — read current settings
 * PUT  /api/system/settings — update settings (persisted to .mind/settings.json)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgency } from '@/lib/agency';

interface MindSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  port?: number;
  wsPort?: number;
  heartbeatIntervalMs?: number;
}

export async function GET() {
  const agency = getAgency();
  await agency.system.loadSettings();

  const s = agency.system.settings;
  // Mask API key
  const masked = { ...s, apiKey: s.apiKey ? '••••••••' + s.apiKey.slice(-4) : undefined };
  return NextResponse.json(masked);
}

export async function PUT(request: NextRequest) {
  try {
    const body: MindSettings = await request.json();
    const agency = getAgency();
    await agency.system.loadSettings();

    const current = agency.system.settings;

    // Only update non-undefined fields. API key: only update if not masked.
    if (body.apiKey && !body.apiKey.startsWith('••••')) current.apiKey = body.apiKey;
    else if (body.apiKey && body.apiKey.startsWith('••••') && body.apiKey.length === 12) {
      // User re-entered masked value — keep existing
    } else if (body.apiKey === '') {
      delete current.apiKey;
    }

    if (body.baseUrl !== undefined) {
      if (body.baseUrl) current.baseUrl = body.baseUrl; else delete current.baseUrl;
    }
    if (body.model !== undefined) {
      if (body.model) current.model = body.model; else delete current.model;
    }
    if (body.port !== undefined) current.port = body.port;
    if (body.wsPort !== undefined) current.wsPort = body.wsPort;
    if (body.heartbeatIntervalMs !== undefined) current.heartbeatIntervalMs = body.heartbeatIntervalMs;

    await agency.system.saveSettings();
    return NextResponse.json({ success: true, settings: { ...current, apiKey: current.apiKey ? '••••••••' + current.apiKey.slice(-4) : undefined } });
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}
