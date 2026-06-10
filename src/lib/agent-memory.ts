/**
 * agent-memory.ts — Memory management for AgentProxy.
 */

import { MemoryEntry } from './memory';

/**
 * Get a specific memory entry for an agent.
 */
export async function getAgentMemory(agentName: string, key: string): Promise<MemoryEntry | null> {
  const { readMemory } = await import('./memory');
  return readMemory(agentName, key);
}

/**
 * Save a memory entry for an agent.
 */
export async function saveAgentMemory(agentName: string, key: string, value: string): Promise<MemoryEntry> {
  const { writeMemory } = await import('./memory');
  return writeMemory(agentName, key, value);
}

/**
 * Search memories using semantic search.
 */
export async function searchAgentMemory(agentName: string, query: string): Promise<MemoryEntry[]> {
  const { searchMemory } = await import('./memory');
  return searchMemory(agentName, query);
}

/**
 * List all memories for an agent.
 */
export async function listAgentMemory(agentName: string): Promise<MemoryEntry[]> {
  const { listMemory } = await import('./memory');
  return listMemory(agentName);
}
