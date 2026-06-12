/**
 * Providers Tests
 */

import { describe, it, expect } from 'vitest';
import { getProvider, listProviders } from '../src/lib/providers';

// Import providers to register them
import '../src/lib/providers/claude';
import '../src/lib/providers/claude-proxy';
import '../src/lib/providers/codex';

describe('Providers', () => {
  it('should list providers', () => {
    const providers = listProviders();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
  });

  it('should get provider by name', () => {
    const provider = getProvider('claude-proxy');
    expect(provider).toBeDefined();
  });

  it('should return undefined for unknown provider', () => {
    const provider = getProvider('unknown-provider');
    expect(provider).toBeUndefined();
  });
});
