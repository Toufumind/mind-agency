/**
 * Per-agent task queue — serializes all operations for the same agent.
 *
 * Prevents race conditions when multiple requests modify the same agent's
 * session concurrently (e.g., user message + auto-respond).
 *
 * Usage:
 *   import { enqueueAgent } from './agent-queue';
 *   const result = await enqueueAgent('Alice', () => doSomething());
 *
 * v1.3: Uses AgentProxy for unified state management.
 */

const queues = new Map<string, Promise<void>>();

export async function enqueueAgent<T>(agent: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(agent) || Promise.resolve();
  let result!: T;
  const wrapped = async () => {
    // v0.8: Set current agent flag to prevent nested enqueueAgent calls
    (global as any).__currentAgent = agent;
    try { result = await task(); } finally { (global as any).__currentAgent = null; }
  };
  const next = prev.then(wrapped, wrapped);
  queues.set(agent, next.then(() => {}, () => {}).finally(() => {
    if (queues.get(agent) === next) queues.delete(agent);
  }));
  await next;
  return result;
}

/**
 * Get the current agent being processed (for deadlock prevention).
 */
export function getCurrentAgent(): string | null {
  return (global as any).__currentAgent || null;
}
