/**
 * MemoryProxy — unified memory management in Next.js process.
 *
 * Consolidates ALL memory logic:
 *   - Agent memory read/write (.mind/agents/<agent>/memory/)
 *   - Semantic search (embedding + TF-IDF)
 *   - Memory context for system prompts
 *   - Memory listing
 *
 * Singleton instance — use getMemoryProxy() to access.
 */

import fs from 'fs';
import path from 'path';
import { MIND_DIR } from './data-dir';
import {
  readMemory,
  writeMemory,
  searchMemory,
  listMemory,
  deleteMemory,
  type MemoryEntry,
} from './memory';

// ── Types ─────────────────────────────────────────────────

export type { MemoryEntry };

// ── MemoryProxy class ─────────────────────────────────────

export class MemoryProxy {
  constructor() {}

  // ── Memory Operations ────────────────────────────────

  /**
   * Get a specific memory entry for an agent.
   */
  async getMemory(agentName: string, key: string): Promise<MemoryEntry | null> {
    return readMemory(agentName, key);
  }

  /**
   * Save a memory entry for an agent.
   */
  async saveMemory(agentName: string, key: string, value: string): Promise<MemoryEntry> {
    return writeMemory(agentName, key, value);
  }

  /**
   * Search memories for an agent using semantic search.
   */
  async searchMemory(agentName: string, query: string): Promise<MemoryEntry[]> {
    return searchMemory(agentName, query);
  }

  /**
   * List all memories for an agent.
   */
  async listMemory(agentName: string): Promise<MemoryEntry[]> {
    return listMemory(agentName);
  }

  // ── Cleanup ──────────────────────────────────────────

  /**
   * Cleanup resources.
   */
  destroy(): void {
    // No persistent state to clean up — delegates to memory.ts functions
  }
}

// ── Singleton ─────────────────────────────────────────────

let instance: MemoryProxy | null = null;

export function getMemoryProxy(): MemoryProxy {
  if (!instance) {
    instance = new MemoryProxy();
  }
  return instance;
}
