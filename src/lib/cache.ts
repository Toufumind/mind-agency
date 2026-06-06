/**
 * Unified Cache Layer — centralized caching for all agent data
 *
 * Replaces scattered Map+TTL implementations across chat.ts, cli-commands.ts,
 * memory.ts, state.ts with a single managed cache system.
 *
 * Features:
 *   - TTL-based expiration
 *   - Size limits per region (LRU eviction)
 *   - Unified invalidation API
 *
 * Usage:
 *   import { agentCache } from './cache';
 *   const config = agentCache.get<AgentConfig>('config', agentName, 300_000);
 *   agentCache.set('config', agentName, config);
 *   agentCache.invalidateAgent(agentName); // clears all caches for agent
 */

interface CacheEntry<T> {
  data: T;
  ts: number;
}

interface CacheRegion {
  name: string;
  defaultTTL: number;
  maxSize: number;
  data: Map<string, CacheEntry<any>>;
}

class AgentCache {
  private regions = new Map<string, CacheRegion>();

  constructor() {
    // Pre-define cache regions with default TTLs and size limits
    this.createRegion('config', 300_000, 200);       // 5 min, max 200 entries
    this.createRegion('identity', 300_000, 200);     // 5 min, max 200
    this.createRegion('membership', 300_000, 200);   // 5 min, max 200
    this.createRegion('groups', 300_000, 100);       // 5 min, max 100
    this.createRegion('memory', 60_000, 500);        // 1 min, max 500
    this.createRegion('goals', 60_000, 200);         // 1 min, max 200
    this.createRegion('session', 10_000, 200);       // 10s, max 200
    this.createRegion('groupChat', 30_000, 50);      // 30s, max 50 groups
    this.createRegion('agents', 300_000, 200);       // 5 min, max 200
    this.createRegion('emails', 60_000, 500);        // 1 min, max 500
    this.createRegion('state', 10_000, 200);         // 10s, max 200
  }

  private createRegion(name: string, defaultTTL: number, maxSize: number): void {
    this.regions.set(name, { name, defaultTTL, maxSize, data: new Map() });
  }

  /**
   * Evict oldest entries if region exceeds max size (LRU).
   */
  private evictIfNeeded(region: CacheRegion): void {
    if (region.data.size <= region.maxSize) return;
    // Sort by timestamp, delete oldest
    const entries = [...region.data.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const toDelete = entries.slice(0, entries.length - region.maxSize);
    for (const [key] of toDelete) {
      region.data.delete(key);
    }
  }

  /**
   * Get cached value. Returns null if missing or expired.
   */
  get<T>(region: string, key: string, ttl?: number): T | null {
    const r = this.regions.get(region);
    if (!r) return null;
    const entry = r.data.get(key);
    if (!entry) return null;
    const maxAge = ttl ?? r.defaultTTL;
    if (Date.now() - entry.ts > maxAge) {
      r.data.delete(key);
      return null;
    }
    return entry.data as T;
  }

  /**
   * Set cached value. Evicts oldest entries if region exceeds max size.
   */
  set<T>(region: string, key: string, data: T): void {
    const r = this.regions.get(region);
    if (!r) return;
    r.data.set(key, { data, ts: Date.now() });
    this.evictIfNeeded(r);
  }

  /**
   * Invalidate a specific key in a region.
   */
  invalidate(region: string, key: string): void {
    const r = this.regions.get(region);
    if (r) r.data.delete(key);
  }

  /**
   * Invalidate all entries in a region.
   */
  invalidateRegion(region: string): void {
    const r = this.regions.get(region);
    if (r) r.data.clear();
  }

  /**
   * Invalidate all caches for a specific agent.
   * Call this when agent config, CLAUDE.md, or membership changes.
   */
  invalidateAgent(agentName: string): void {
    for (const region of this.regions.values()) {
      region.data.delete(agentName);
    }
  }

  /**
   * Clear all caches entirely.
   */
  clearAll(): void {
    for (const region of this.regions.values()) {
      region.data.clear();
    }
  }

  /**
   * Get cache stats for debugging.
   */
  stats(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [name, region] of this.regions) {
      result[name] = region.data.size;
    }
    return result;
  }
}

/** Global singleton cache instance */
export const agentCache = new AgentCache();
