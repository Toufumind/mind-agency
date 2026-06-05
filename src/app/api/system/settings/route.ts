/**
 * GET  /api/system/settings — read current settings
 * PUT  /api/system/settings — update settings (persisted to .mind/settings.json)
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MIND_DIR } from '@/lib/data-dir';

const SETTINGS_FILE = path.join(MIND_DIR, 'settings.json');

interface MindSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  port?: number;
  wsPort?: number;
  heartbeatIntervalMs?: number;
}

function loadSettings(): MindSettings {
  // Start from file, fallback to env, then merge file wins
  const s: MindSettings = {
    apiKey: process.env.ANTHROPIC_AUTH_TOKEN || '',
    baseUrl: process.env.ANTHROPIC_BASE_URL || '',
    model: process.env.ANTHROPIC_MODEL || '',
  };
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const file = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      if (file.apiKey) s.apiKey = file.apiKey;
      if (file.baseUrl) s.baseUrl = file.baseUrl;
      if (file.model) s.model = file.model;
      if (file.port) s.port = file.port;
      if (file.wsPort) s.wsPort = file.wsPort;
      if (file.heartbeatIntervalMs !== undefined) s.heartbeatIntervalMs = file.heartbeatIntervalMs;
    }
  } catch {}
  return s;
}

function saveSettings(s: MindSettings): void {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), 'utf-8');
}

export async function GET() {
  const s = loadSettings();
  // Mask API key
  const masked = { ...s, apiKey: s.apiKey ? '••••••••' + s.apiKey.slice(-4) : undefined };
  return NextResponse.json(masked);
}

export async function PUT(request: NextRequest) {
  try {
    const body: MindSettings = await request.json();
    const current = loadSettings();

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

    saveSettings(current);
    return NextResponse.json({ success: true, settings: { ...current, apiKey: current.apiKey ? '••••••••' + current.apiKey.slice(-4) : undefined } });
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}
