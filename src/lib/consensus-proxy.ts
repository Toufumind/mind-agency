/**
 * ConsensusProxy — unified consensus management in Next.js process.
 *
 * Consolidates ALL consensus logic:
 *   - Pending request lookup (Groups/<group>/.consensus/)
 *   - Decision submission (APPROVED / REJECTED)
 *   - Request listing and filtering
 *
 * Singleton instance — use getConsensusProxy() to access.
 */

import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from './data-dir';
import {
  listPendingRequests,
  getRequest,
  submitDecision as submitDecisionToEngine,
  type ConsensusRequest,
  type DecisionResult,
} from './consensus';

// ── Types ─────────────────────────────────────────────────

export type { ConsensusRequest, DecisionResult };

// ── ConsensusProxy class ──────────────────────────────────

export class ConsensusProxy {
  private _pendingCache: Map<string, ConsensusRequest[]> = new Map();
  private _cacheTime: Map<string, number> = new Map();
  private static readonly CACHE_TTL = 5_000; // 5s

  constructor() {}

  // ── Request Management ───────────────────────────────

  /**
   * Get all pending consensus requests for a group.
   */
  async getPendingRequests(groupName: string): Promise<ConsensusRequest[]> {
    const now = Date.now();
    const cached = this._pendingCache.get(groupName);
    const cachedTime = this._cacheTime.get(groupName) || 0;

    if (cached && (now - cachedTime) < ConsensusProxy.CACHE_TTL) {
      return cached;
    }

    try {
      const requests = listPendingRequests(groupName);
      const pending = requests.filter(
        r => r.status === 'pending' || r.status === 'adversary_review' || r.status === 'rebuttal'
      );

      this._pendingCache.set(groupName, pending);
      this._cacheTime.set(groupName, now);

      return pending;
    } catch {}

    return [];
  }

  /**
   * Submit a decision (APPROVED / REJECTED) for a consensus request.
   */
  async submitDecision(
    groupName: string,
    requestId: string,
    agent: string,
    decision: 'APPROVED' | 'REJECTED'
  ): Promise<DecisionResult> {
    const result = submitDecisionToEngine(groupName, requestId, agent, decision);

    // Invalidate cache for this group
    this._pendingCache.delete(groupName);
    this._cacheTime.delete(groupName);

    return result;
  }

  /**
   * Get all requests (any status) for a group.
   */
  async getRequests(groupName: string): Promise<ConsensusRequest[]> {
    try {
      return listPendingRequests(groupName);
    } catch {}

    return [];
  }

  // ── Cleanup ──────────────────────────────────────────

  /**
   * Invalidate cache for a group.
   */
  invalidateCache(groupName?: string): void {
    if (groupName) {
      this._pendingCache.delete(groupName);
      this._cacheTime.delete(groupName);
    } else {
      this._pendingCache.clear();
      this._cacheTime.clear();
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this._pendingCache.clear();
    this._cacheTime.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────

let instance: ConsensusProxy | null = null;

export function getConsensusProxy(): ConsensusProxy {
  if (!instance) {
    instance = new ConsensusProxy();
  }
  return instance;
}
