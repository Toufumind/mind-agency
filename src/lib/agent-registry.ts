/**
 * AgentRegistry — singleton manager for all AgentProxy instances.
 *
 * Provides centralized access to agent proxies:
 *   - getOrCreate(name) — get existing or create new proxy
 *   - getAll() — list all proxies
 *   - getByGroup(groupName) — find agents in a group
 *   - remove(name) — remove proxy from registry
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR, GROUPS_DIR } from './data-dir';
import { AgentProxy } from './agent-proxy';

class AgentRegistry {
  private proxies = new Map<string, AgentProxy>();

  /**
   * Get existing proxy or create new one.
   * If agent doesn't exist on disk, still creates proxy (for pre-creation).
   */
  getOrCreate(name: string): AgentProxy {
    let proxy = this.proxies.get(name);
    if (!proxy) {
      proxy = new AgentProxy(name);
      this.proxies.set(name, proxy);
    }
    return proxy;
  }

  /**
   * Get proxy if it exists in registry.
   */
  get(name: string): AgentProxy | undefined {
    return this.proxies.get(name);
  }

  /**
   * Get all proxies for agents that exist on disk.
   * Auto-discovers agents from AGENTS_DIR.
   */
  getAll(): AgentProxy[] {
    this.discoverAgents();

    const result: AgentProxy[] = [];
    for (const proxy of this.proxies.values()) {
      if (proxy.exists()) {
        result.push(proxy);
      }
    }
    return result;
  }

  /**
   * Get all agent names that exist on disk.
   */
  getAllNames(): string[] {
    return this.getAll().map(p => p.name);
  }

  /**
   * Find all agents that belong to a specific group.
   */
  getByGroup(groupName: string): AgentProxy[] {
    const agentsDir = path.join(GROUPS_DIR, groupName, 'Agents');
    if (!fs.existsSync(agentsDir)) return [];

    const result: AgentProxy[] = [];
    try {
      const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          result.push(this.getOrCreate(entry.name));
        }
      }
    } catch {}

    return result;
  }

  /**
   * Remove proxy from registry (e.g., when agent is deleted).
   */
  remove(name: string): void {
    const proxy = this.proxies.get(name);
    if (proxy) {
      proxy.destroy(); // Stop claude.exe process
      this.proxies.delete(name);
    }
  }

  /**
   * Invalidate cache for a specific agent.
   */
  invalidate(name: string): void {
    const proxy = this.proxies.get(name);
    if (proxy) {
      proxy.invalidateCache();
    }
  }

  /**
   * Invalidate all caches.
   */
  invalidateAll(): void {
    for (const proxy of this.proxies.values()) {
      proxy.invalidateCache();
    }
  }

  /**
   * Discover agents from disk and add to registry.
   */
  private discoverAgents(): void {
    if (!fs.existsSync(AGENTS_DIR)) return;

    try {
      const entries = fs.readdirSync(AGENTS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          if (!this.proxies.has(entry.name)) {
            this.proxies.set(entry.name, new AgentProxy(entry.name));
          }
        }
      }
    } catch {}
  }
}

// Singleton instance
let registry: AgentRegistry | null = null;

export function getAgentRegistry(): AgentRegistry {
  if (!registry) {
    registry = new AgentRegistry();
  }
  return registry;
}

export { AgentRegistry };
