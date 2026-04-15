/**
 * Logging utilities for MCP-TikTok
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  module: string;
  message: string;
  data?: Record<string, unknown>;
}

class Logger {
  private static instance: Logger;
  private logLevel: LogLevel = 'info';
  private modules: Set<string> = new Set();

  private constructor() {}

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public setLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  public registerModule(module: string): void {
    this.modules.add(module);
  }

  private formatEntry(entry: LogEntry): string {
    const timestamp = new Date(entry.timestamp).toISOString();
    let output = `[${timestamp}] [${entry.level.toUpperCase()}] [${entry.module}] ${entry.message}`;
    
    if (entry.data) {
      output += ` ${JSON.stringify(entry.data)}`;
    }
    
    return output;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  private log(level: LogLevel, module: string, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      module,
      message,
      data,
    };

    const formatted = this.formatEntry(entry);

    switch (level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  public debug(module: string, message: string, data?: Record<string, unknown>): void {
    this.log('debug', module, message, data);
  }

  public info(module: string, message: string, data?: Record<string, unknown>): void {
    this.log('info', module, message, data);
  }

  public warn(module: string, message: string, data?: Record<string, unknown>): void {
    this.log('warn', module, message, data);
  }

  public error(module: string, message: string, data?: Record<string, unknown>): void {
    this.log('error', module, message, data);
  }
}

// Module-specific logger factories
export function createLogger(module: string) {
  const logger = Logger.getInstance();
  logger.registerModule(module);
  
  return {
    debug: (message: string, data?: Record<string, unknown>) => logger.debug(module, message, data),
    info: (message: string, data?: Record<string, unknown>) => logger.info(module, message, data),
    warn: (message: string, data?: Record<string, unknown>) => logger.warn(module, message, data),
    error: (message: string, data?: Record<string, unknown>) => logger.error(module, message, data),
  };
}

// Export module-specific loggers
export const logger = createLogger('MCP-TikTok');
