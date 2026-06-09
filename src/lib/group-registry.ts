/**
 * GroupRegistry — singleton manager for all GroupProxy instances.
 *
 * Provides centralized access to group proxies:
 *   - getOrCreate(name) — get existing or create new proxy
 *   - getAll() — list all proxies
 *   - getByAgent(agentName) — find groups an agent belongs to
 *   - remove(name) — remove proxy from registry
 */

import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from './data-dir';
import { GroupProxy } from './group-proxy';

class GroupRegistry {
  private proxies = new Map<string, GroupProxy>();

  /**
   * Get existing proxy or create new one.
   */
  getOrCreate(name: string): GroupProxy {
    let proxy = this.proxies.get(name);
    if (!proxy) {
      proxy = new GroupProxy(name);
      this.proxies.set(name, proxy);
    }
    return proxy;
  }

  /**
   * Get proxy if it exists in registry.
   */
  get(name: string): GroupProxy | undefined {
    return this.proxies.get(name);
  }

  /**
   * Get all proxies for groups that exist on disk.
   */
  getAll(): GroupProxy[] {
    this.discoverGroups();

    const result: GroupProxy[] = [];
    for (const proxy of this.proxies.values()) {
      if (proxy.exists()) {
        result.push(proxy);
      }
    }
    return result;
  }

  /**
   * Get all group names that exist on disk.
   */
  getAllNames(): string[] {
    return this.getAll().map(p => p.name);
  }

  /**
   * Find all groups an agent belongs to.
   */
  getByAgent(agentName: string): GroupProxy[] {
    const result: GroupProxy[] = [];
    for (const proxy of this.getAll()) {
      if (proxy.isMember(agentName)) {
        result.push(proxy);
      }
    }
    return result;
  }

  /**
   * Remove proxy from registry.
   */
  remove(name: string): void {
    const proxy = this.proxies.get(name);
    if (proxy) {
      proxy.destroy();
      this.proxies.delete(name);
    }
  }

  /**
   * Invalidate cache for a specific group.
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
   * Discover groups from disk and add to registry.
   */
  private discoverGroups(): void {
    if (!fs.existsSync(GROUPS_DIR)) return;

    try {
      const entries = fs.readdirSync(GROUPS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          if (!this.proxies.has(entry.name)) {
            this.proxies.set(entry.name, new GroupProxy(entry.name));
          }
        }
      }
    } catch {}
  }
}

// Singleton instance
let registry: GroupRegistry | null = null;

export function getGroupRegistry(): GroupRegistry {
  if (!registry) {
    registry = new GroupRegistry();
  }
  return registry;
}

export { GroupRegistry };
