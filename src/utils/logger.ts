import type { LogLevel } from '../types/bot';

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export const createLogger = (level: LogLevel): Logger => {
  const shouldLog = (target: LogLevel): boolean =>
    priorities[target] >= priorities[level];

  const write = (target: LogLevel, message: string, ...args: unknown[]) => {
    if (!shouldLog(target)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${target.toUpperCase()}]`;
    const sink = target === 'error' ? console.error : console.log;
    sink(prefix, message, ...args);
  };

  return {
    debug: (message, ...args) => write('debug', message, ...args),
    info: (message, ...args) => write('info', message, ...args),
    warn: (message, ...args) => write('warn', message, ...args),
    error: (message, ...args) => write('error', message, ...args),
  };
};
