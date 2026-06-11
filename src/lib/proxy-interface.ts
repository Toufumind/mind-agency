/**
 * Common interface for all proxy classes.
 * Provides unified lifecycle management and cache invalidation.
 */

export interface Proxy {
  /** Invalidate all cached data, forcing next read to hit disk */
  invalidateCache(): void;

  /** Clean up resources (child processes, intervals, etc.) */
  destroy(): void;
}
