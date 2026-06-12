/**
 * Error Handler Tests
 */

import { describe, it, expect } from 'vitest';
import {
  safeAsync,
  safeSync,
  errorResponse,
  successResponse,
  wrapError,
  timeoutError,
  withTimeout,
} from '../src/lib/error-handler';

describe('Error Handler', () => {
  describe('safeAsync', () => {
    it('should return result on success', async () => {
      const result = await safeAsync(async () => 'ok', 'fallback');
      expect(result).toBe('ok');
    });

    it('should return fallback on error', async () => {
      const result = await safeAsync(async () => { throw new Error('fail'); }, 'fallback');
      expect(result).toBe('fallback');
    });
  });

  describe('safeSync', () => {
    it('should return result on success', () => {
      const result = safeSync(() => 'ok', 'fallback');
      expect(result).toBe('ok');
    });

    it('should return fallback on error', () => {
      const result = safeSync(() => { throw new Error('fail'); }, 'fallback');
      expect(result).toBe('fallback');
    });
  });

  describe('errorResponse', () => {
    it('should create error response', () => {
      const response = errorResponse('test error', 'TEST_CODE');
      expect(response.ok).toBe(false);
      expect(response.error).toBe('test error');
      expect(response.code).toBe('TEST_CODE');
    });
  });

  describe('successResponse', () => {
    it('should create success response', () => {
      const response = successResponse({ data: 'test' });
      expect(response.ok).toBe(true);
      expect(response.data).toEqual({ data: 'test' });
    });
  });

  describe('wrapError', () => {
    it('should wrap Error instance', () => {
      const error = wrapError(new Error('original'), 'context');
      expect(error.message).toBe('context: original');
    });

    it('should wrap non-Error value', () => {
      const error = wrapError('string error', 'context');
      expect(error.message).toBe('context: string error');
    });
  });

  describe('timeoutError', () => {
    it('should create timeout error', () => {
      const error = timeoutError(5000);
      expect(error.message).toContain('5000ms');
    });
  });

  describe('withTimeout', () => {
    it('should resolve before timeout', async () => {
      const result = await withTimeout(Promise.resolve('ok'), 1000);
      expect(result).toBe('ok');
    });

    it('should reject on timeout', async () => {
      await expect(
        withTimeout(new Promise(() => {}), 100)
      ).rejects.toThrow('timed out');
    });
  });
});
