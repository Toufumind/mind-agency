/**
 * Workflow Engine Tests
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

vi.mock('../src/lib/event-bus', async () => {
  const actual = await vi.importActual('../src/lib/event-bus');
  return {
    ...actual,
    EventBus: vi.fn().mockImplementation(() => ({
      emit: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      getStats: vi.fn().mockReturnValue({}),
    })),
  };
});

import { parseWorkflowYaml } from '../src/lib/event-bus';

describe('Workflow Engine', () => {
  it('should parse workflow YAML', () => {
    const yaml = `
name: test-workflow
steps:
  - id: step1
    agent: alice
    action: chat
    prompt: Hello
`;
    const def = parseWorkflowYaml(yaml);
    expect(def).toBeDefined();
    expect(def.name).toBe('test-workflow');
    expect(def.steps).toHaveLength(1);
  });

  it('should throw on empty YAML', () => {
    expect(() => parseWorkflowYaml('')).toThrow('Invalid workflow YAML');
  });
});
