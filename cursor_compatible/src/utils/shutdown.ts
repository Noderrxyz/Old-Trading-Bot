import { TelemetryBus } from '../telemetry/TelemetryBus';
import { createComponentLogger } from './logger';

// High: Global shutdown orchestrator to cleanup singletons/resources
const logger = createComponentLogger('Shutdown');
let registered = false;

export function registerGlobalShutdownHooks(): void {
  if (registered) return;
  registered = true;

  const cleanup = async (signal: string) => {
    try {
      logger.info(`Received ${signal}, starting graceful shutdown`);
      // Cleanup TelemetryBus and other singletons
      try {
        TelemetryBus.getInstance().cleanup();
      } catch (e) {
        logger.warn('Error during TelemetryBus cleanup', { error: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      // Allow process managers to handle exit; do not force exit here
      logger.info('Cleanup complete');
    }
  };

  process.on('SIGINT', () => void cleanup('SIGINT'));
  process.on('SIGTERM', () => void cleanup('SIGTERM'));
  process.on('beforeExit', () => {
    try {
      TelemetryBus.getInstance().cleanup();
    } catch {}
  });
}


