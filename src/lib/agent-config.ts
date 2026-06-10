/**
 * agent-config.ts — Configuration management for AgentProxy.
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR } from './data-dir';
import { agentCache } from './cache';
import { AgentConfig } from './agent-types';

/**
 * Load agent config from disk (config.json).
 * Returns the parsed config, or DEFAULT_CONFIG on error.
 */
export async function loadAgentConfig(agentName: string): Promise<AgentConfig> {
  try {
    const cf = path.join(AGENTS_DIR, agentName, 'config.json');
    if (fs.existsSync(cf)) {
      const data = JSON.parse(fs.readFileSync(cf, 'utf-8'));
      return {
        roles: data.roles || [],
        permissions: data.permissions,
        autoRespondToEmail: data.autoRespondToEmail,
        autoProcessGroupInvites: data.autoProcessGroupInvites,
        notifyOnEmail: data.notifyOnEmail ?? true,
        notifyOnGroupMention: data.notifyOnGroupMention ?? true,
        behavior: data.behavior,
        provider: data.provider,
        model: data.model,
        apiKey: data.apiKey,
        baseUrl: data.baseUrl,
        permissionMode: data.permissionMode,
        allowedTools: data.allowedTools,
        disallowedTools: data.disallowedTools,
        maxTurns: data.maxTurns,
      };
    }
  } catch {}
  return {} as AgentConfig;
}

/**
 * Save agent config to disk (config.json).
 */
export async function saveAgentConfig(agentName: string, config: AgentConfig): Promise<void> {
  try {
    const agentDir = path.join(AGENTS_DIR, agentName);
    if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });

    const cf = path.join(agentDir, 'config.json');
    fs.writeFileSync(cf, JSON.stringify(config, null, 2), 'utf-8');
    agentCache.invalidate('config', agentName);
  } catch (err) {
    console.error(`[agent-config] saveAgentConfig(${agentName}):`, err);
  }
}
