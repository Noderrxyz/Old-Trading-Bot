import { TelemetryBus } from '../telemetry/TelemetryBus';
import { logger } from '../utils/logger';
import { LaunchManager } from '../orchestration/LaunchManager';
import { AutoMutationLoop } from '../evolution/AutoMutationLoop';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

interface PanicTrigger {
  type: 'drawdown' | 'gas' | 'flashbots' | 'retry';
  severity: 'warning' | 'critical';
  threshold: number;
  window: number; // in milliseconds
}

interface PanicConfig {
  triggers: PanicTrigger[];
  cooldown: number; // in milliseconds
}

export class PanicManager {
  private static instance: PanicManager;
  private isPanicked = false;
  private lastPanicTime = 0;
  private config: PanicConfig;
  private launchManager: LaunchManager;
  private mutationLoop: AutoMutationLoop;
  private panicLogPath: string;

  private constructor() {
    this.launchManager = LaunchManager.getInstance();
    this.mutationLoop = AutoMutationLoop.getInstance();
    this.panicLogPath = path.join(process.cwd(), 'logs', 'panic_log.jsonl');
    this.config = this.loadConfig();
    this.setupTelemetry();
  }

  public static getInstance(): PanicManager {
    if (!PanicManager.instance) {
      PanicManager.instance = new PanicManager();
    }
    return PanicManager.instance;
  }

  private loadConfig(): PanicConfig {
    try {
      const configPath = path.join(process.cwd(), 'config', 'guardrails.yaml');
      const configContent = fs.readFileSync(configPath, 'utf-8');
      return yaml.load(configContent) as PanicConfig;
    } catch (error) {
      logger.error('Failed to load panic config:', error);
      return {
        triggers: [
          {
            type: 'drawdown',
            severity: 'critical',
            threshold: 0.1, // 10% drawdown
            window: 60000 // 1 minute
          },
          {
            type: 'gas',
            severity: 'critical',
            threshold: 200, // 200 gwei
            window: 300000 // 5 minutes
          },
          {
            type: 'flashbots',
            severity: 'critical',
            threshold: 3, // 3 rejections
            window: 300000 // 5 minutes
          },
          {
            type: 'retry',
            severity: 'critical',
            threshold: 5, // 5 retries
            window: 10000 // 10 seconds
          }
        ],
        cooldown: 300000 // 5 minutes
      };
    }
  }

  private setupTelemetry() {
    const telemetryBus = TelemetryBus.getInstance();

    // Monitor drawdowns
    telemetryBus.on('agent_metrics', (event: any) => {
      if (event.drawdown > this.getTrigger('drawdown').threshold) {
        this.handlePanic('drawdown', {
          agentId: event.id,
          drawdown: event.drawdown,
          threshold: this.getTrigger('drawdown').threshold
        });
      }
    });

    // Monitor gas prices
    telemetryBus.on('gas_metrics', (event: any) => {
      if (event.price > this.getTrigger('gas').threshold) {
        this.handlePanic('gas', {
          price: event.price,
          threshold: this.getTrigger('gas').threshold
        });
      }
    });

    // Monitor Flashbots rejections
    telemetryBus.on('flashbots_rejection', (event: any) => {
      const rejections = this.countEvents('flashbots', this.getTrigger('flashbots').window);
      if (rejections >= this.getTrigger('flashbots').threshold) {
        this.handlePanic('flashbots', {
          rejections,
          threshold: this.getTrigger('flashbots').threshold
        });
      }
    });

    // Monitor retries
    telemetryBus.on('retry', (event: any) => {
      const retries = this.countEvents('retry', this.getTrigger('retry').window);
      if (retries >= this.getTrigger('retry').threshold) {
        this.handlePanic('retry', {
          retries,
          threshold: this.getTrigger('retry').threshold
        });
      }
    });
  }

  private getTrigger(type: string): PanicTrigger {
    return this.config.triggers.find(t => t.type === type)!;
  }

  private countEvents(type: string, window: number): number {
    try {
      const logs = this.readPanicLog();
      const cutoff = Date.now() - window;
      return logs.filter(log => 
        log.type === type && 
        new Date(log.timestamp).getTime() > cutoff
      ).length;
    } catch (error) {
      logger.error('Failed to count events:', error);
      return 0;
    }
  }

  private readPanicLog(): any[] {
    try {
      if (!fs.existsSync(this.panicLogPath)) {
        return [];
      }
      const content = fs.readFileSync(this.panicLogPath, 'utf-8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    } catch (error) {
      logger.error('Failed to read panic log:', error);
      return [];
    }
  }

  private writePanicLog(entry: any) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        ...entry
      };
      fs.appendFileSync(this.panicLogPath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      logger.error('Failed to write panic log:', error);
    }
  }

  private async handlePanic(type: string, details: any) {
    if (this.isPanicked) {
      logger.warn('System already in panic state');
      return;
    }

    const now = Date.now();
    if (now - this.lastPanicTime < this.config.cooldown) {
      logger.warn('Panic cooldown active');
      return;
    }

    this.isPanicked = true;
    this.lastPanicTime = now;

    // Log panic event
    this.writePanicLog({
      type,
      details,
      action: 'panic_triggered'
    });

    // Stop all agents and mutation loop
    try {
      const agents = await this.launchManager.listAgents();
      for (const agent of agents) {
        await this.launchManager.stopAgent(agent.id);
      }
      this.mutationLoop.stop();
      logger.error(`Panic triggered: ${type}`, details);
    } catch (error) {
      logger.error('Failed to execute panic:', error);
    }
  }

  public async triggerPanic() {
    await this.handlePanic('manual', { triggeredBy: 'operator' });
  }

  public async resetPanic() {
    if (!this.isPanicked) {
      return;
    }

    const now = Date.now();
    if (now - this.lastPanicTime < this.config.cooldown) {
      throw new Error('Cannot reset during cooldown period');
    }

    this.isPanicked = false;
    this.writePanicLog({
      action: 'panic_reset'
    });
  }

  public isInPanic(): boolean {
    return this.isPanicked;
  }

  public getLastPanicTime(): number {
    return this.lastPanicTime;
  }
} 