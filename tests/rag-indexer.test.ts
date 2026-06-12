/**
 * RAG Indexer Tests
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/rag', () => ({
  indexAll: vi.fn().mockResolvedValue({ memory: 0, skills: 0, knowledge: 0, groupKnowledge: 0 }),
  indexAgentMemory: vi.fn().mockResolvedValue(0),
  indexAgentSkills: vi.fn().mockResolvedValue(0),
  indexAgentKnowledge: vi.fn().mockResolvedValue(0),
  indexGroupKnowledge: vi.fn().mockResolvedValue(0),
  indexSessionContext: vi.fn().mockResolvedValue(undefined),
}));

import { ragIndexer, scheduleFullIndex, scheduleSessionIndex } from '../src/lib/rag-indexer';

describe('RAG Indexer', () => {
  it('should enqueue job', () => {
    const jobId = ragIndexer.enqueue('test-agent', 'full');
    expect(jobId).toBeDefined();
    expect(jobId).toMatch(/^job-/);
  });

  it('should get queue status', () => {
    const status = ragIndexer.getStatus();
    expect(status).toBeDefined();
  });

  it('should schedule full index', () => {
    const jobId = scheduleFullIndex('test-agent');
    expect(jobId).toBeDefined();
  });

  it('should schedule session index', () => {
    const jobId = scheduleSessionIndex('test-agent', [{ role: 'user', content: 'test' }]);
    expect(jobId).toBeDefined();
  });
});
