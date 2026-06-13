/**
 * BaseProxy — common base for all proxy classes.
 *
 * Provides:
 *   - Cache layer integration (via agentCache)
 *   - Singleton factory pattern
 *   - Common cache helpers
 *
 * Usage:
 *   class MyProxy extends BaseProxy {
 *     constructor() { super('my-region'); }
 *     // ... proxy-specific methods
 *   }
 *   export const getMyProxy = createSingleton(MyProxy);
 */

import { agentCache } from './cache';

export class BaseProxy {
  protected region: string;

  constructor(region: string) {
    this.region = region;
  }

  /** Get cached value or undefined. */
  protected cacheGet<T>(key: string, ttl?: number): T | undefined {
    return agentCache.get<T>(this.region, key, ttl) ?? undefined;
  }

  /** Set cached value. */
  protected cacheSet<T>(key: string, value: T): void {
    agentCache.set(this.region, key, value);
  }

  /** Invalidate a specific cache key. */
  protected cacheInvalidate(key: string): void {
    agentCache.invalidate(this.region, key);
  }

  /** Invalidate all cached values in this region. */
  protected cacheInvalidateAll(): void {
    agentCache.invalidateRegion(this.region);
  }

  /** Cleanup. */
  destroy(): void {
    this.cacheInvalidateAll();
  }
}

/**
 * Create a singleton factory for a proxy class.
 *
 * Usage:
 *   export const getMyProxy = createSingleton(MyProxy);
 */
export function createSingleton<T extends BaseProxy>(Cls: new () => T): () => T {
  let instance: T | null = null;
  return () => {
    if (!instance) instance = new Cls();
    return instance;
  };
}
