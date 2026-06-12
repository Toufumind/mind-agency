/**
 * Process Tracker Tests
 */

import { describe, it, expect } from 'vitest';
import { trackQuery, untrackQuery, killAllQueries, activeQueryCount } from '../src/lib/process-tracker';

describe('Process Tracker', () => {
  it('should track and untrack query', () => {
    const controller = trackQuery();
    expect(controller).toBeDefined();
    expect(activeQueryCount()).toBeGreaterThan(0);

    untrackQuery(controller);
  });

  it('should kill all queries', () => {
    trackQuery();
    trackQuery();

    killAllQueries();
    expect(activeQueryCount()).toBe(0);
  });

  it('should get active query count', () => {
    const count = activeQueryCount();
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
