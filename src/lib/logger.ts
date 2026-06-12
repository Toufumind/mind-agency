/**
 * logger.ts — Structured logging with consistent prefixes
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

class Logger {
  private module: string;
  private level: LogLevel;

  constructor(module: string, level: LogLevel = LogLevel.INFO) {
    this.module = module;
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${this.module}] [${LOG_LEVEL_NAMES[level]}]`;
    const base = `${timestamp} ${prefix} ${message}`;

    if (data !== undefined) {
      return `${base} ${JSON.stringify(data)}`;
    }
    return base;
  }

  debug(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(this.formatMessage(LogLevel.DEBUG, message, data));
    }
  }

  info(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(this.formatMessage(LogLevel.INFO, message, data));
    }
  }

  warn(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage(LogLevel.WARN, message, data));
    }
  }

  error(message: string, error?: Error | any): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const errorData = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error;
      console.error(this.formatMessage(LogLevel.ERROR, message, errorData));
    }
  }

  /**
   * Create a child logger with a sub-module name
   */
  child(subModule: string): Logger {
    return new Logger(`${this.module}:${subModule}`, this.level);
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

/**
 * Create a logger for a module
 */
export function createLogger(module: string, level?: LogLevel): Logger {
  return new Logger(module, level);
}

/**
 * Default loggers for common modules
 */
export const loggers = {
  chat: createLogger('chat'),
  agent: createLogger('agent'),
  rag: createLogger('rag'),
  relay: createLogger('relay'),
  ws: createLogger('ws'),
  scheduler: createLogger('scheduler'),
  autoRespond: createLogger('autoRespond'),
  workflow: createLogger('workflow'),
  economy: createLogger('economy'),
  mcp: createLogger('mcp'),
};

/**
 * Get log level from environment
 */
export function getLogLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toUpperCase();
  switch (level) {
    case 'DEBUG': return LogLevel.DEBUG;
    case 'INFO': return LogLevel.INFO;
    case 'WARN': return LogLevel.WARN;
    case 'ERROR': return LogLevel.ERROR;
    default: return LogLevel.INFO;
  }
}
