/**
 * Simple logger for the scoring system
 * In a production environment, this would be replaced with a proper logging solution
 */
export class Logger {
  private context: string;
  
  constructor(context: string) {
    this.context = context;
  }
  
  public debug(message: string, data?: unknown): void {
    this.log('DEBUG', message, data);
  }
  
  public info(message: string, data?: unknown): void {
    this.log('INFO', message, data);
  }
  
  public warn(message: string, data?: unknown): void {
    this.log('WARN', message, data);
  }
  
  public error(message: string, data?: unknown): void {
    this.log('ERROR', message, data);
  }
  
  public metrics(metrics: Record<string, unknown>): void {
    const metricsWithTimestamp = {
      ...metrics,
      timestamp: Date.now()
    };
    
    // In a production environment, this would send to a metrics system
    this.log('METRICS', JSON.stringify(metricsWithTimestamp));
  }
  
  private log(level: string, message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level}] [${this.context}] ${message}`;
    
    if (typeof process !== 'undefined' && process.stdout && process.stderr) {
      // Node.js environment
      const stream = level === 'ERROR' ? process.stderr : process.stdout;
      
      if (data) {
        stream.write(`${formattedMessage}\n${JSON.stringify(data, null, 2)}\n`);
      } else {
        stream.write(`${formattedMessage}\n`);
      }
    } else {
      // Browser environment
      /* eslint-disable no-console */
      if (level === 'ERROR') {
        if (data) {
          console.error(formattedMessage, data);
        } else {
          console.error(formattedMessage);
        }
      } else if (level === 'WARN') {
        if (data) {
          console.warn(formattedMessage, data);
        } else {
          console.warn(formattedMessage);
        }
      } else {
        if (data) {
          console.log(formattedMessage, data);
        } else {
          console.log(formattedMessage);
        }
      }
      /* eslint-enable no-console */
    }
  }
} 