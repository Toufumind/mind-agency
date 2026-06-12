/**
 * Embedding Tests
 */

import { describe, it, expect } from 'vitest';
import { embed, cosineSimilarity } from '../src/lib/embedding';

describe('Embedding', () => {
  it('should embed text', () => {
    const vector = embed('Hello world');
    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBeGreaterThan(0);
  });

  it('should return consistent embeddings', () => {
    const v1 = embed('test text');
    const v2 = embed('test text');
    expect(v1).toEqual(v2);
  });

  it('should return different embeddings for different text', () => {
    const v1 = embed('hello');
    const v2 = embed('world');
    expect(v1).not.toEqual(v2);
  });

  it('should calculate cosine similarity', () => {
    const v1 = embed('hello world');
    const v2 = embed('hello world');
    const similarity = cosineSimilarity(v1, v2);
    expect(similarity).toBeGreaterThan(0.9);
  });

  it('should handle empty text', () => {
    const vector = embed('');
    expect(Array.isArray(vector)).toBe(true);
  });

  it('should handle Chinese text', () => {
    const vector = embed('你好世界');
    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBeGreaterThan(0);
  });
});
