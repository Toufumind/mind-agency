/**
 * Chat Tests
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'path';

vi.mock('../src/lib/data-dir', () => ({
  MIND_DIR: path.join(__dirname, '.test-data', '.mind'),
  AGENTS_DIR: path.join(__dirname, '.test-data', 'Agents'),
  AUDIT_DIR: path.join(__dirname, '.test-data', '.audit'),
  GROUPS_DIR: path.join(__dirname, '.test-data', 'Groups'),
  MCP_DIR: path.join(__dirname, '..', 'mcp'),
  SRC_DIR: path.join(__dirname, '..', 'src'),
  DATA_DIR: path.join(__dirname, '.test-data'),
  default: path.join(__dirname, '.test-data'),
}));

vi.mock('../src/lib/atomic', () => ({
  atomicWrite: vi.fn((filePath: string, content: string) => {
    const fs = require('fs');
    const p = require('path');
    const dir = p.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
  }),
}));

vi.mock('../src/lib/relay', () => ({
  relay: vi.fn().mockResolvedValue({
    content: 'test response',
    usage: { tokensIn: 10, tokensOut: 5, cost: 0.001 },
    balance: 9999,
    model: 'test-model',
    latencyMs: 100,
  }),
}));

import { getChatHistory, clearChat, getAgentConfig } from '../src/lib/chat';

describe('Chat', () => {
  it('should get chat history', () => {
    const history = getChatHistory('test-chat');
    expect(history).toBeDefined();
    expect(history).toHaveProperty('sessionId');
    expect(history).toHaveProperty('messages');
  });

  it('should clear chat', () => {
    clearChat('test-clear');
    const history = getChatHistory('test-clear');
    expect(history.messages).toEqual([]);
  });

  it('should get agent config', () => {
    const config = getAgentConfig('test-config');
    expect(config).toBeDefined();
    expect(config).toHaveProperty('roles');
  });
});
