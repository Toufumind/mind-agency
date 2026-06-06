/**
 * GET /api/system/models — fetch available models from configured API
 */

import { NextResponse } from 'next/server';
import { MIND_DIR } from '@/lib/data-dir';
import http from 'http';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Read API config from settings
  const settingsPath = path.join(MIND_DIR, 'settings.json');
  let settings: any = {};
  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch {}

  const baseUrl = settings.baseUrl || '';
  const apiKey = settings.apiKey || '';

  if (!baseUrl || !apiKey) {
    return NextResponse.json({ models: getDefaultModels(), source: 'default' });
  }

  // v0.4: Query API, but if it fails, use the configured model as the only option
  try {
    const models = await fetchModels(baseUrl, apiKey);
    if (models.length > 0) {
      return NextResponse.json({ models, source: 'api' });
    }
  } catch {}

  // API query failed — use the configured model from settings
  const configuredModel = settings.model || '';
  if (configuredModel) {
    return NextResponse.json({ models: [{ id: configuredModel, label: configuredModel }], source: 'configured' });
  }
  return NextResponse.json({ models: getDefaultModels(), source: 'default' });
}

function getDefaultModels() {
  return [
    { id: 'deepseek-v4-pro', label: 'V4 Pro' },
    { id: 'deepseek-v4-flash', label: 'V4 Flash' },
    { id: 'claude-sonnet-4-20250514', label: 'Sonnet 4' },
    { id: 'claude-opus-4-20250514', label: 'Opus 4' },
  ];
}

function fetchModels(baseUrl: string, apiKey: string): Promise<Array<{ id: string; label: string }>> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl.replace(/\/+$/, '')}/v1/models`);
    const req = http.get({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { 'Authorization': `Bearer ${apiKey}` },
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const models = (data.data || []).map((m: any) => ({
            id: m.id,
            label: m.id.split('/').pop() || m.id,
          }));
          resolve(models.length > 0 ? models : getDefaultModels());
        } catch {
          resolve(getDefaultModels());
        }
      });
    });
    req.on('error', () => resolve(getDefaultModels()));
    req.on('timeout', () => { req.destroy(); resolve(getDefaultModels()); });
  });
}
