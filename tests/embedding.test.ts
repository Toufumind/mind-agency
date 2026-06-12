/**
 * Embedding Tests
 */

import { describe, it, expect } from 'vitest';
import { embed, cosineSimilarity } from '../src/lib/embedding';

describe('Embedding', () => {
  it('should embed text', async () => {
    const vector = await embed('Hello world');
    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBeGreaterThan(0);
  }, 30000);

  it('should return consistent embeddings', async () => {
    const v1 = await embed('test text');
    const v2 = await embed('test text');
    expect(v1).toEqual(v2);
  }, 30000);

  it('should return different embeddings for different text', async () => {
    const v1 = await embed('hello');
    const v2 = await embed('world');
    expect(v1).not.toEqual(v2);
  }, 30000);

  it('should calculate cosine similarity', async () => {
    const v1 = await embed('hello world');
    const v2 = await embed('hello world');
    const similarity = cosineSimilarity(v1, v2);
    expect(similarity).toBeGreaterThan(0.9);
  }, 30000);

  it('should handle empty text', async () => {
    const vector = await embed('');
    expect(Array.isArray(vector)).toBe(true);
  }, 30000);

  it('should handle Chinese text', async () => {
    const vector = await embed('你好世界');
    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBeGreaterThan(0);
  }, 30000);
});
