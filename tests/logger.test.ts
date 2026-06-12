/**
 * Logger Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, LogLevel } from '../src/lib/logger';

describe('Logger', () => {
  let consoleDebug: any;
  let consoleLog: any;
  let consoleWarn: any;
  let consoleError: any;

  beforeEach(() => {
    consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create logger with module name', () => {
    const logger = createLogger('test');
    logger.info('test message');
    expect(consoleLog).toHaveBeenCalled();
    expect(consoleLog.mock.calls[0][0]).toContain('[test]');
    expect(consoleLog.mock.calls[0][0]).toContain('[INFO]');
    expect(consoleLog.mock.calls[0][0]).toContain('test message');
  });

  it('should respect log level', () => {
    const logger = createLogger('test', LogLevel.WARN);

    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');

    expect(consoleDebug).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });

  it('should create child logger', () => {
    const logger = createLogger('parent');
    const child = logger.child('child');

    child.info('test message');
    expect(consoleLog.mock.calls[0][0]).toContain('[parent:child]');
  });

  it('should include data in message', () => {
    const logger = createLogger('test');
    logger.info('test message', { key: 'value' });

    expect(consoleLog.mock.calls[0][0]).toContain('"key":"value"');
  });

  it('should format errors correctly', () => {
    const logger = createLogger('test');
    const error = new Error('test error');

    logger.error('Something failed', error);

    expect(consoleError.mock.calls[0][0]).toContain('test error');
    expect(consoleError.mock.calls[0][0]).toContain('[ERROR]');
  });
});
