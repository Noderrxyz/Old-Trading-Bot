import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { LaunchManager } from '../src/orchestration/LaunchManager';
import { TelemetryBus } from '../src/telemetry/TelemetryBus';
import { logger } from '../src/utils/logger';
import { AlphaMemoryEngine } from '../src/memory/AlphaMemoryEngine';

interface LaunchProfile {
  environment: string;
  telemetry: {
    enabled: boolean;
    level: string;
  };
  retry: {
    max_attempts: number;
    delay_ms: number;
  };
  logging: {
    level: string;
    file: string;
  };
}

interface StrategyConfig {
  count: number;
  sort_by?: string;
  min_trust?: number;
  type?: string;
  markets: string[];
  config?: Record<string, any>;
}

interface LaunchConfig {
  profiles: Record<string, LaunchProfile>;
  strategies: Record<string, StrategyConfig>;
}

export class LaunchOrchestrator {
  private config: LaunchConfig;
  private launchManager: LaunchManager;
  private telemetryBus: TelemetryBus;
  private memoryEngine: AlphaMemoryEngine;
  private logFile: string;

  constructor(configPath: string) {
    this.config = this.loadConfig(configPath);
    this.launchManager = LaunchManager.getInstance();
    this.telemetryBus = TelemetryBus.getInstance();
    this.memoryEngine = AlphaMemoryEngine.getInstance();
    this.logFile = path.join(process.cwd(), 'logs', 'launch_log.jsonl');
  }

  private loadConfig(configPath: string): LaunchConfig {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      return yaml.load(content) as LaunchConfig;
    } catch (error) {
      logger.error('Failed to load launch config:', error);
      throw error;
    }
  }

  private writeLaunchLog(entry: any) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        ...entry
      };
      fs.appendFileSync(this.logFile, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      logger.error('Failed to write launch log:', error);
    }
  }

  private async deployStrategy(profile: string, strategy: string) {
    const profileConfig = this.config.profiles[profile];
    const strategyConfig = this.config.strategies[strategy];

    if (!profileConfig || !strategyConfig) {
      throw new Error(`Invalid profile or strategy: ${profile}, ${strategy}`);
    }

    // Configure telemetry
    this.telemetryBus.setLevel(profileConfig.telemetry.level);

    // Get top strategies based on config
    const snapshots = await this.memoryEngine.querySnapshots({
      type: strategyConfig.type,
      minTrust: strategyConfig.min_trust,
      sortBy: strategyConfig.sort_by,
      limit: strategyConfig.count
    });

    // Deploy agents for each market
    for (const market of strategyConfig.markets) {
      for (const snapshot of snapshots) {
        try {
          const agentId = await this.launchManager.launch({
            strategyId: snapshot.id,
            market,
            config: strategyConfig.config || {},
            retry: {
              maxAttempts: profileConfig.retry.max_attempts,
              delayMs: profileConfig.retry.delay_ms
            }
          });

          this.writeLaunchLog({
            profile,
            strategy,
            market,
            agentId,
            status: 'launched',
            snapshot: snapshot.id
          });

          logger.info(`Launched agent ${agentId} for ${market}`);
        } catch (error) {
          this.writeLaunchLog({
            profile,
            strategy,
            market,
            status: 'failed',
            error: error.message
          });

          logger.error(`Failed to launch agent for ${market}:`, error);
        }
      }
    }
  }

  public async launchTopStrategies(profile: string = 'local') {
    await this.deployStrategy(profile, 'top_performers');
  }

  public async launchMarketMakers(profile: string = 'local') {
    await this.deployStrategy(profile, 'market_makers');
  }

  public async launchArbitrage(profile: string = 'local') {
    await this.deployStrategy(profile, 'arbitrage');
  }

  public async launchAll(profile: string = 'local') {
    await this.launchTopStrategies(profile);
    await this.launchMarketMakers(profile);
    await this.launchArbitrage(profile);
  }
}

// CLI interface
if (require.main === module) {
  const orchestrator = new LaunchOrchestrator(
    path.join(process.cwd(), 'config', 'launch_profiles.yaml')
  );

  const command = process.argv[2];
  const profile = process.argv[3] || 'local';

  switch (command) {
    case 'top':
      orchestrator.launchTopStrategies(profile);
      break;
    case 'market-makers':
      orchestrator.launchMarketMakers(profile);
      break;
    case 'arbitrage':
      orchestrator.launchArbitrage(profile);
      break;
    case 'all':
      orchestrator.launchAll(profile);
      break;
    default:
      console.error('Invalid command. Use: top, market-makers, arbitrage, or all');
      process.exit(1);
  }
} 