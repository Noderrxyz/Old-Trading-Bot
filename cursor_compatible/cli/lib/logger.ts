/**
 * Simple CLI Logger
 * 
 * Provides logging functionality for CLI commands
 */

import chalk from 'chalk';

// Log levels
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1, 
  WARN: 2,
  ERROR: 3,
  SUCCESS: 4,
};

// Logger interface
interface Logger {
  debug: (...args: any[]) => void;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  success: (...args: any[]) => void;
}

// Current log level (can be set via environment variable)
const CURRENT_LEVEL = process.env.LOG_LEVEL 
  ? (LOG_LEVELS[process.env.LOG_LEVEL as keyof typeof LOG_LEVELS] || LOG_LEVELS.INFO)
  : LOG_LEVELS.INFO;

// Chalk styling
const styles = {
  debug: chalk.gray,
  info: chalk.white,
  warn: chalk.yellow,
  error: chalk.red,
  success: chalk.green,
};

// Logger implementation
export const logger: Logger = {
  debug: (...args: any[]) => {
    if (CURRENT_LEVEL <= LOG_LEVELS.DEBUG) {
      console.log(styles.debug('[DEBUG]'), ...args);
    }
  },
  
  info: (...args: any[]) => {
    if (CURRENT_LEVEL <= LOG_LEVELS.INFO) {
      console.log(styles.info('[INFO]'), ...args);
    }
  },
  
  warn: (...args: any[]) => {
    if (CURRENT_LEVEL <= LOG_LEVELS.WARN) {
      console.log(styles.warn('[WARN]'), ...args);
    }
  },
  
  error: (...args: any[]) => {
    if (CURRENT_LEVEL <= LOG_LEVELS.ERROR) {
      console.error(styles.error('[ERROR]'), ...args);
    }
  },
  
  success: (...args: any[]) => {
    if (CURRENT_LEVEL <= LOG_LEVELS.SUCCESS) {
      console.log(styles.success('[SUCCESS]'), ...args);
    }
  }
};

export default logger; 