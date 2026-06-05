/**
 * Agent Provider Interface — v0.4
 *
 * Abstracts different AI agent CLI/API backends.
 * Each provider knows how to spawn and communicate with its agent.
 */

import type { ChatEvent } from '../chat';

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  [key: string]: unknown;
}

export interface SpawnOptions {
  agentName: string;
  prompt: string;
  systemPrompt?: string;
  mcpServers?: Record<string, unknown>;
  config?: ProviderConfig;
  conversationId?: string;
}

export interface AgentProvider {
  /** Unique identifier */
  name: string;
  /** Display name */
  displayName: string;
  /** Check if this provider is available on this machine */
  isAvailable(): boolean;
  /** Get the default model for this provider */
  getDefaultModel(): string;
  /** Execute a prompt and stream response events */
  execute(opts: SpawnOptions): AsyncGenerator<ChatEvent>;
}

// ── Provider registry ────────────────────────────────────

const providers = new Map<string, AgentProvider>();

export function registerProvider(provider: AgentProvider): void {
  providers.set(provider.name, provider);
}

export function getProvider(name: string): AgentProvider | undefined {
  return providers.get(name);
}

export function listProviders(): Array<{ name: string; displayName: string; available: boolean }> {
  return [...providers.values()].map(p => ({
    name: p.name,
    displayName: p.displayName,
    available: p.isAvailable(),
  }));
}

export function getDefaultProvider(): AgentProvider {
  // Prefer claude, fallback to first available
  return providers.get('claude') || [...providers.values()][0];
}
