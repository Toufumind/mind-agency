/**
 * Provider Profiles — Multiple API configurations with one-click switching.
 *
 * Inspired by CC Switch's provider management:
 * - Multiple profiles (DeepSeek, OpenAI, etc.)
 * - One-click activation (updates settings.json + env)
 * - No restart needed (hot-switch via env update)
 */

import fs from 'fs';
import path from 'path';
import { MIND_DIR } from './data-dir';
import { randomUUID } from 'crypto';

// ── Types ────────────────────────────────────────────────

export interface ProviderProfile {
  id: string;
  name: string;
  provider: 'claude' | 'codex';
  apiKey: string;
  baseUrl: string;
  model: string;
  isActive: boolean;
  createdAt: number;
}

// ── Storage ──────────────────────────────────────────────

const PROFILES_FILE = path.join(MIND_DIR, 'provider-profiles.json');

function ensureDir(): void {
  if (!fs.existsSync(MIND_DIR)) fs.mkdirSync(MIND_DIR, { recursive: true });
}

function loadProfiles(): ProviderProfile[] {
  ensureDir();
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

function saveProfiles(profiles: ProviderProfile[]): void {
  ensureDir();
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf-8');
}

// ── Settings integration ─────────────────────────────────

const SETTINGS_FILE = path.join(MIND_DIR, 'settings.json');

interface MindSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  provider?: string;
  port?: number;
  wsPort?: number;
  heartbeatIntervalMs?: number;
}

function loadSettings(): MindSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveSettings(settings: MindSettings): void {
  ensureDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

// ── CRUD ─────────────────────────────────────────────────

export function listProfiles(): ProviderProfile[] {
  return loadProfiles();
}

export function getProfile(id: string): ProviderProfile | undefined {
  return loadProfiles().find(p => p.id === id);
}

export function createProfile(data: {
  name: string;
  provider: 'claude' | 'codex';
  apiKey: string;
  baseUrl: string;
  model: string;
}): ProviderProfile {
  const profiles = loadProfiles();
  const profile: ProviderProfile = {
    id: randomUUID().slice(0, 8),
    name: data.name,
    provider: data.provider,
    apiKey: data.apiKey,
    baseUrl: data.baseUrl,
    model: data.model,
    isActive: profiles.length === 0, // First profile is auto-active
    createdAt: Date.now(),
  };
  profiles.push(profile);
  saveProfiles(profiles);

  // If first profile, activate it
  if (profile.isActive) {
    activateProfile(profile.id);
  }

  return profile;
}

export function updateProfile(id: string, data: Partial<{
  name: string;
  provider: 'claude' | 'codex';
  apiKey: string;
  baseUrl: string;
  model: string;
}>): ProviderProfile | null {
  const profiles = loadProfiles();
  const idx = profiles.findIndex(p => p.id === id);
  if (idx === -1) return null;

  const old = profiles[idx];
  profiles[idx] = { ...old, ...data };
  saveProfiles(profiles);

  // If active profile was updated, sync to settings
  if (profiles[idx].isActive) {
    syncToSettings(profiles[idx]);
  }

  return profiles[idx];
}

export function deleteProfile(id: string): boolean {
  const profiles = loadProfiles();
  const idx = profiles.findIndex(p => p.id === id);
  if (idx === -1) return false;

  const wasActive = profiles[idx].isActive;
  profiles.splice(idx, 1);

  // If deleted profile was active, activate the first remaining
  if (wasActive && profiles.length > 0) {
    profiles[0].isActive = true;
    syncToSettings(profiles[0]);
  }

  saveProfiles(profiles);
  return true;
}

// ── Activation (the key algorithm) ───────────────────────

export function activateProfile(id: string): boolean {
  const profiles = loadProfiles();
  const target = profiles.find(p => p.id === id);
  if (!target) return false;

  // Set target as active, others as inactive
  for (const p of profiles) {
    p.isActive = (p.id === id);
  }
  saveProfiles(profiles);

  // Sync to settings.json (this is what chat.ts reads)
  syncToSettings(target);

  return true;
}

function syncToSettings(profile: ProviderProfile): void {
  const settings = loadSettings();
  settings.apiKey = profile.apiKey;
  settings.baseUrl = profile.baseUrl;
  settings.model = profile.model;
  settings.provider = profile.provider;
  saveSettings(settings);

  // Update process.env for immediate effect
  if (profile.provider === 'claude') {
    process.env.ANTHROPIC_AUTH_TOKEN = profile.apiKey;
    process.env.ANTHROPIC_BASE_URL = profile.baseUrl;
    process.env.ANTHROPIC_MODEL = profile.model;
  } else if (profile.provider === 'codex') {
    process.env.OPENAI_API_KEY = profile.apiKey;
    process.env.CODEX_MODEL = profile.model;
  }
}

export function getActiveProfile(): ProviderProfile | null {
  const profiles = loadProfiles();
  return profiles.find(p => p.isActive) || null;
}

// ── Import from existing settings ────────────────────────

export function importFromSettings(): ProviderProfile | null {
  const settings = loadSettings();
  if (!settings.apiKey) return null;

  const profiles = loadProfiles();
  // Don't import if a profile with same baseUrl already exists
  if (profiles.some(p => p.baseUrl === settings.baseUrl)) return null;

  return createProfile({
    name: settings.provider === 'codex' ? 'OpenAI' : 'Default',
    provider: (settings.provider as 'claude' | 'codex') || 'claude',
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl || 'https://api.anthropic.com',
    model: settings.model || 'claude-sonnet-4-20250514',
  });
}
