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

import { agentCache } from './cache';

export class ConsensusProxy {
  constructor() {}

  // ── Request Management ───────────────────────────────

  /**
   * Get all pending consensus requests for a group.
   */
  async getPendingRequests(groupName: string): Promise<ConsensusRequest[]> {
    const cached = agentCache.get<ConsensusRequest[]>('consensus', groupName);
    if (cached) return cached;

    try {
      const requests = listPendingRequests(groupName);
      const pending = requests.filter(
        r => r.status === 'pending' || r.status === 'adversary_review' || r.status === 'rebuttal'
      );

      agentCache.set('consensus', groupName, pending);

      return pending;
    } catch (err) {
      console.warn(`[consensus-proxy] Failed to get pending requests for ${groupName}:`, err);
    }

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
    agentCache.invalidate('consensus', groupName);

    return result;
  }

  /**
   * Get all requests (any status) for a group.
   */
  async getRequests(groupName: string): Promise<ConsensusRequest[]> {
    try {
      return listPendingRequests(groupName);
    } catch (e) { console.error('[lib:consensus-proxy]', e); }

    return [];
  }

  // ── Cleanup ──────────────────────────────────────────

  /**
   * Invalidate cache for a group.
   */
  invalidateCache(groupName?: string): void {
    if (groupName) {
      agentCache.invalidate('consensus', groupName);
    } else {
      agentCache.invalidateRegion('consensus');
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    agentCache.invalidateRegion('consensus');
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
