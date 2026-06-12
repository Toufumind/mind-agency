/**
 * error-handler.ts — Unified error handling utilities
 */

import { createLogger } from './logger';

const logger = createLogger('error-handler');

/**
 * Safe async wrapper — catches and logs errors
 */
export function safeAsync<T>(
  fn: () => Promise<T>,
  fallback: T,
  context?: string
): Promise<T> {
  return fn().catch((error) => {
    if (context) {
      logger.error(`${context}: ${error.message}`, error);
    }
    return fallback;
  });
}

/**
 * Safe sync wrapper — catches and logs errors
 */
export function safeSync<T>(
  fn: () => T,
  fallback: T,
  context?: string
): T {
  try {
    return fn();
  } catch (error: any) {
    if (context) {
      logger.error(`${context}: ${error.message}`, error);
    }
    return fallback;
  }
}

/**
 * Create error response
 */
export function errorResponse(message: string, code?: string): { ok: false; error: string; code?: string } {
  return { ok: false, error: message, code };
}

/**
 * Create success response
 */
export function successResponse<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

/**
 * Wrap error with context
 */
export function wrapError(error: unknown, context: string): Error {
  if (error instanceof Error) {
    error.message = `${context}: ${error.message}`;
    return error;
  }
  return new Error(`${context}: ${String(error)}`);
}

/**
 * Log and rethrow
 */
export function logAndRethrow(error: unknown, context: string): never {
  const wrappedError = wrapError(error, context);
  logger.error(wrappedError.message, wrappedError);
  throw wrappedError;
}

/**
 * Create timeout error
 */
export function timeoutError(ms: number): Error {
  return new Error(`Operation timed out after ${ms}ms`);
}

/**
 * Race with timeout
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(timeoutError(ms)), ms);
    }),
  ]);
}
