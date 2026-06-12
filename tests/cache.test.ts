/**
 * Cache Tests
 */

import { describe, it, expect } from 'vitest';
import { agentCache } from '../src/lib/cache';

describe('AgentCache', () => {
  it('should store and retrieve values', () => {
    agentCache.set('config', 'test-alice', { name: 'alice' });
    const result = agentCache.get('config', 'test-alice');
    expect(result).toEqual({ name: 'alice' });
  });

  it('should return null for missing keys', () => {
    const result = agentCache.get('config', 'test-missing');
    expect(result).toBeNull();
  });

  it('should invalidate specific key', () => {
    agentCache.set('config', 'test-alice', { name: 'alice' });
    agentCache.invalidate('config', 'test-alice');
    expect(agentCache.get('config', 'test-alice')).toBeNull();
  });

  it('should invalidate all keys for agent', () => {
    agentCache.set('config', 'test-alice', { name: 'alice' });
    agentCache.set('session', 'test-alice', { messages: [] });
    agentCache.set('config', 'test-bob', { name: 'bob' });

    agentCache.invalidateAgent('test-alice');

    expect(agentCache.get('config', 'test-alice')).toBeNull();
    expect(agentCache.get('session', 'test-alice')).toBeNull();
    expect(agentCache.get('config', 'test-bob')).toEqual({ name: 'bob' });
  });

  it('should track hit/miss stats', () => {
    agentCache.set('config', 'test-stats', { name: 'stats' });
    agentCache.get('config', 'test-stats'); // hit
    agentCache.get('config', 'test-missing-stats'); // miss

    const stats = agentCache.stats();
    expect(stats.hits).toBeGreaterThan(0);
    expect(stats.misses).toBeGreaterThan(0);
  });

  it('should clear all caches', () => {
    agentCache.set('config', 'test-clear1', { name: 'clear1' });
    agentCache.set('session', 'test-clear2', { messages: [] });

    agentCache.clearAll();

    expect(agentCache.get('config', 'test-clear1')).toBeNull();
    expect(agentCache.get('session', 'test-clear2')).toBeNull();
  });
});
