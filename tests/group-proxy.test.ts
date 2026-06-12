/**
 * Group Proxy Tests
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

import { GroupProxy } from '../src/lib/group-proxy';

describe('GroupProxy', () => {
  it('should create group proxy instance', () => {
    const proxy = new GroupProxy('test-group');
    expect(proxy).toBeDefined();
    expect(proxy.name).toBe('test-group');
  });

  it('should load config', async () => {
    const proxy = new GroupProxy('test-config');
    await proxy.loadConfig();
    expect(proxy.config).toBeDefined();
  });
});
