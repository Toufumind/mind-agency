/**
 * Audit Proxy Tests
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

import { getAuditProxy } from '../src/lib/audit-proxy';

describe('Audit Proxy', () => {
  it('should get audit proxy', () => {
    const proxy = getAuditProxy();
    expect(proxy).toBeDefined();
  });

  it('should get audit logs', async () => {
    const proxy = getAuditProxy();
    const logs = await proxy.getAuditLogs();
    expect(Array.isArray(logs)).toBe(true);
  });
});
