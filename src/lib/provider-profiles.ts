/**
 * Provider Profiles — Multiple API configurations with one-click switching.
 *
 * Inspired by CC Switch's provider management:
 * - Multiple profiles (DeepSeek, OpenAI, etc.)
 * - One-click activation (updates settings.json + env)
 * - No restart needed (hot-switch via env update)
 *
 * Uses SystemProxy for file system access.
 */

import path from 'path';
import { MIND_DIR } from './data-dir';
import { randomUUID } from 'crypto';
import { getSystemProxy } from './system-proxy';

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

async function loadProfiles(): Promise<ProviderProfile[]> {
  const proxy = getSystemProxy();
  return proxy.loadProviderProfiles();
}

async function saveProfiles(profiles: ProviderProfile[]): Promise<void> {
  const proxy = getSystemProxy();
  await proxy.saveProviderProfiles(profiles);
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

async function loadSettings(): Promise<MindSettings> {
  const proxy = getSystemProxy();
  return proxy.loadSettings();
}

async function saveSettings(settings: MindSettings): Promise<void> {
  const proxy = getSystemProxy();
  await proxy.saveSettings();
}

// ── CRUD ─────────────────────────────────────────────────

export async function listProfiles(): Promise<ProviderProfile[]> {
  return loadProfiles();
}

export async function getProfile(id: string): Promise<ProviderProfile | undefined> {
  const profiles = await loadProfiles();
  return profiles.find(p => p.id === id);
}

export async function createProfile(data: {
  name: string;
  provider: 'claude' | 'codex';
  apiKey: string;
  baseUrl: string;
  model: string;
}): Promise<ProviderProfile> {
  const profiles = await loadProfiles();
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
  await saveProfiles(profiles);

  // If first profile, activate it
  if (profile.isActive) {
    await activateProfile(profile.id);
  }

  return profile;
}

export async function updateProfile(id: string, data: Partial<{
  name: string;
  provider: 'claude' | 'codex';
  apiKey: string;
  baseUrl: string;
  model: string;
}>): Promise<ProviderProfile | null> {
  const profiles = await loadProfiles();
  const idx = profiles.findIndex(p => p.id === id);
  if (idx === -1) return null;

  const old = profiles[idx];
  profiles[idx] = { ...old, ...data };
  await saveProfiles(profiles);

  // If active profile was updated, sync to settings
  if (profiles[idx].isActive) {
    await syncToSettings(profiles[idx]);
  }

  return profiles[idx];
}

export async function deleteProfile(id: string): Promise<boolean> {
  const profiles = await loadProfiles();
  const idx = profiles.findIndex(p => p.id === id);
  if (idx === -1) return false;

  const wasActive = profiles[idx].isActive;
  profiles.splice(idx, 1);

  // If deleted profile was active, activate the first remaining
  if (wasActive && profiles.length > 0) {
    profiles[0].isActive = true;
    await syncToSettings(profiles[0]);
  }

  await saveProfiles(profiles);
  return true;
}

// ── Activation (the key algorithm) ───────────────────────

export async function activateProfile(id: string): Promise<boolean> {
  const profiles = await loadProfiles();
  const target = profiles.find(p => p.id === id);
  if (!target) return false;

  // Set target as active, others as inactive
  for (const p of profiles) {
    p.isActive = (p.id === id);
  }
  await saveProfiles(profiles);

  // Sync to settings.json (this is what chat.ts reads)
  await syncToSettings(target);

  return true;
}

async function syncToSettings(profile: ProviderProfile): Promise<void> {
  const settings = await loadSettings();
  settings.apiKey = profile.apiKey;
  settings.baseUrl = profile.baseUrl;
  settings.model = profile.model;
  settings.provider = profile.provider;
  await saveSettings(settings);

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

export async function getActiveProfile(): Promise<ProviderProfile | null> {
  const profiles = await loadProfiles();
  return profiles.find(p => p.isActive) || null;
}

// ── Import from existing settings ────────────────────────

export async function importFromSettings(): Promise<ProviderProfile | null> {
  const settings = await loadSettings();
  if (!settings.apiKey) return null;

  const profiles = await loadProfiles();
  // Don't import if a profile with same baseUrl already exists
  if (profiles.some(p => p.baseUrl === settings.baseUrl)) return null;

  return createProfile({
    name: settings.provider === 'codex' ? 'OpenAI' : 'Default',
    provider: (settings.provider as 'claude' | 'codex') || 'claude',
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl || 'https://api.anthropic.com',
    model: settings.model || 'mimo-v2.5',
  });
}
