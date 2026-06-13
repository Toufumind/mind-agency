/**
 * GET /api/system/models — fetch available models from configured API
 */

import { NextResponse } from 'next/server';
import { getAgency } from '@/lib/agency';
import http from 'http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const agency = getAgency();
  await agency.system.loadSettings();

  const baseUrl = agency.system.settings.baseUrl || '';
  const apiKey = agency.system.settings.apiKey || '';

  if (!baseUrl || !apiKey) {
    return NextResponse.json({ models: [], source: 'none' });
  }

  // v0.4: Query API, but if it fails, use the configured model as the only option
  try {
    const models = await fetchModels(baseUrl, apiKey);
    if (models.length > 0) {
      return NextResponse.json({ models, source: 'api' });
    }
  } catch {}

  // API query failed — use the configured model from settings
  const configuredModel = agency.system.settings.model || '';
  if (configuredModel) {
    return NextResponse.json({ models: [{ id: configuredModel, label: configuredModel }], source: 'configured' });
  }
  return NextResponse.json({ models: getDefaultModels(), source: 'default' });
}

function getDefaultModels() {
  return [
    { id: 'mimo-v2.5', label: 'MiMo V2.5' },
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
        // v0.4: If status is not 200, reject (don't fallback to defaults)
        if (res.statusCode !== 200) {
          reject(new Error(`API returned ${res.statusCode}`));
          return;
        }
        try {
          const data = JSON.parse(body);
          const models = (data.data || []).map((m: any) => ({
            id: m.id,
            label: m.id.split('/').pop() || m.id,
          }));
          resolve(models);
        } catch {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}
