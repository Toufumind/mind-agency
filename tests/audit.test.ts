/**
 * Audit Tests
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'path';

vi.mock('../src/lib/data-dir', () => ({
  AUDIT_DIR: path.join(__dirname, '.test-data', '.audit'),
  MIND_DIR: path.join(__dirname, '.test-data', '.mind'),
  AGENTS_DIR: path.join(__dirname, '.test-data', 'Agents'),
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

import { writeAudit, readAuditLogs } from '../src/lib/audit';

describe('Audit', () => {
  it('should write audit entry', () => {
    writeAudit({
      agent: 'test-agent',
      action: 'test.action',
      resource: 'test-resource',
      details: 'test details',
    });
    // Just verify it doesn't throw
    expect(true).toBe(true);
  });

  it('should read audit log', async () => {
    const log = await readAuditLogs(10);
    expect(Array.isArray(log)).toBe(true);
  });
});
