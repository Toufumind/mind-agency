/**
 * API Settings — centralized settings.json reader.
 *
 * Replaces process.env mutation for API configuration.
 * Both chat.ts and providers read from here.
 */

import fs from 'fs';
import path from 'path';
import { MIND_DIR } from './data-dir';

interface ApiSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

let cached: ApiSettings | null = null;
let loaded = false;

function readSettings(): ApiSettings {
  const defaults: ApiSettings = {
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'mimo-v2.5',
  };

  try {
    const settingsFile = path.join(MIND_DIR, 'settings.json');
    if (fs.existsSync(settingsFile)) {
      const s = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      return {
        apiKey: s.apiKey || defaults.apiKey,
        baseUrl: s.baseUrl || defaults.baseUrl,
        model: s.model || defaults.model,
      };
    }
  } catch {}

  return defaults;
}

/**
 * Get API settings (cached, lazy-loaded).
 * Call invalidate() after settings.json changes.
 */
export function getApiSettings(): ApiSettings {
  if (!loaded || !cached) {
    cached = readSettings();
    loaded = true;
  }
  return cached;
}

/** Force reload on next getApiSettings() call. */
export function invalidateApiSettings(): void {
  loaded = false;
  cached = null;
}

/**
 * Get API key for provider use.
 * Checks spawnOpts config first, then settings.json, then env vars.
 */
export function getApiKey(config?: { apiKey?: string }): string {
  return config?.apiKey || getApiSettings().apiKey || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || '';
}

/**
 * Get base URL for provider use.
 */
export function getBaseUrl(config?: { baseUrl?: string }): string {
  return config?.baseUrl || getApiSettings().baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
}

/**
 * Get model for provider use.
 */
export function getModel(config?: { model?: string }): string {
  return config?.model || getApiSettings().model || process.env.ANTHROPIC_MODEL || 'mimo-v2.5';
}
