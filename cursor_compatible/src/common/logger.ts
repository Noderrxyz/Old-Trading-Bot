/**
 * Logger Module
 * 
 * Provides logging functionality for strategy engine and other components.
 * This is a simple implementation that can be replaced with a more robust
 * logging system in production.
 */

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  SUCCESS = 'success',
  WARN = 'warn',
  ERROR = 'error'
}

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  success(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

/**
 * Global log level
 */
let globalLogLevel: LogLevel = LogLevel.INFO;

/**
 * Set the global log level
 * @param level Log level
 */
export function setLogLevel(level: LogLevel): void {
  globalLogLevel = level;
}

/**
 * Check if a log level is enabled
 * @param level Log level to check
 * @returns True if the level is enabled
 */
function isLevelEnabled(level: LogLevel): boolean {
  const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.SUCCESS, LogLevel.WARN, LogLevel.ERROR];
  const currentIndex = levels.indexOf(globalLogLevel);
  const levelIndex = levels.indexOf(level);
  
  return levelIndex >= currentIndex;
}

/**
 * Format a log message
 * @param level Log level
 * @param component Component name
 * @param message Message to log
 * @param args Additional arguments
 * @returns Formatted log message
 */
function formatLog(level: LogLevel, component: string, message: string, args: any[]): string {
  const timestamp = new Date().toISOString();
  const levelStr = level.toUpperCase().padEnd(5);
  
  let logMessage = `[${timestamp}] ${levelStr} [${component}] ${message}`;
  
  if (args.length > 0) {
    try {
      const argsStr = args.map(arg => {
        if (arg instanceof Error) {
          return `${arg.name}: ${arg.message}\n${arg.stack}`;
        }
        if (typeof arg === 'object') {
          return JSON.stringify(arg, null, 2);
        }
        return String(arg);
      });
      
      logMessage += ` ${argsStr.join(' ')}`;
    } catch (error) {
      logMessage += ` [Error formatting args: ${error}]`;
    }
  }
  
  return logMessage;
}

/**
 * Create a logger for a component
 * @param component Component name
 * @returns Logger instance
 */
export function createLogger(component: string): Logger {
  return {
    debug(message: string, ...args: any[]): void {
      if (isLevelEnabled(LogLevel.DEBUG)) {
        console.debug(formatLog(LogLevel.DEBUG, component, message, args));
      }
    },
    
    info(message: string, ...args: any[]): void {
      if (isLevelEnabled(LogLevel.INFO)) {
        console.info(formatLog(LogLevel.INFO, component, message, args));
      }
    },
    
    success(message: string, ...args: any[]): void {
      if (isLevelEnabled(LogLevel.SUCCESS)) {
        console.info(formatLog(LogLevel.SUCCESS, component, message, args));
      }
    },
    
    warn(message: string, ...args: any[]): void {
      if (isLevelEnabled(LogLevel.WARN)) {
        console.warn(formatLog(LogLevel.WARN, component, message, args));
      }
    },
    
    error(message: string, ...args: any[]): void {
      if (isLevelEnabled(LogLevel.ERROR)) {
        console.error(formatLog(LogLevel.ERROR, component, message, args));
      }
    }
  };
} 