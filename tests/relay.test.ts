/**
 * Relay Tests
 */

import { describe, it, expect } from 'vitest';
import type { RelayRequest, RelayResponse } from '../src/lib/relay';

describe('Relay', () => {
  it('should have correct RelayRequest interface', () => {
    const request: RelayRequest = {
      agent: 'test-agent',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    expect(request.agent).toBe('test-agent');
    expect(request.messages).toHaveLength(1);
  });

  it('should have correct RelayResponse interface', () => {
    const response: RelayResponse = {
      content: 'Hello!',
      usage: { tokensIn: 10, tokensOut: 5, cost: 0.001 },
      balance: 9999,
      model: 'test-model',
      latencyMs: 100,
    };

    expect(response.content).toBe('Hello!');
    expect(response.usage.tokensIn).toBe(10);
    expect(response.balance).toBe(9999);
  });
});
