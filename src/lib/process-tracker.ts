/**
 * Process Tracker — Track active query AbortControllers for clean shutdown.
 *
 * Each `createChatStream()` registers an AbortController here. On server
 * shutdown, `killAllQueries()` aborts all running queries so the SDK's
 * subprocess cleanup kicks in immediately rather than leaving orphan
 * claude.exe processes behind.
 */

const tracked = new Set<AbortController>();

/** Register a new query. Returns the AbortController that will abort it. */
export function trackQuery(): AbortController {
  const ac = new AbortController();
  tracked.add(ac);
  return ac;
}

/** Remove a completed/errored query from tracking. */
export function untrackQuery(ac: AbortController): void {
  tracked.delete(ac);
}

/**
 * Abort all tracked queries. Used during server shutdown.
 * Returns the number of queries aborted.
 */
export function killAllQueries(): number {
  let count = 0;
  for (const ac of tracked) {
    try { ac.abort(); count++; } catch { /* ignore */ }
  }
  tracked.clear();
  return count;
}

/** Number of currently active queries. */
export function activeQueryCount(): number {
  return tracked.size;
}
