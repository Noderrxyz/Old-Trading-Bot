import { Command } from 'commander';
import { LaunchManager } from '../orchestration/LaunchManager.js';
import { AutoScaler } from '../orchestration/AutoScaler.js';
import { BlueprintBuilder } from '../orchestration/BlueprintBuilder.js';
import logger from '../utils/logger.js';

const program = new Command();

program
  .name('launch-control')
  .description('CLI for managing trading agent deployment and scaling')
  .version('1.0.0');

// Launch Manager commands
program
  .command('launch')
  .description('Launch a new trading agent')
  .requiredOption('-s, --strategy <strategyId>', 'Strategy ID to use')
  .requiredOption('-m, --market <market>', 'Market to trade')
  .requiredOption('-c, --capital <capital>', 'Initial capital', parseFloat)
  .option('-t, --trust-throttle', 'Enable trust throttling', true)
  .option('-r, --max-retries <retries>', 'Maximum retry attempts', '3')
  .option('-d, --retry-delay <delay>', 'Retry delay in milliseconds', '5000')
  .action(async (options) => {
    try {
      const launchManager = LaunchManager.getInstance();
      const agentId = await launchManager.launch({
        strategyId: options.strategy,
        market: options.market,
        capital: options.capital,
        trustThrottle: options.trustThrottle,
        maxRetries: parseInt(options.maxRetries),
        retryDelay: parseInt(options.retryDelay),
        telemetryEnabled: true
      });
      logger.info(`Agent launched successfully with ID: ${agentId}`);
    } catch (error) {
      logger.error('Failed to launch agent:', error);
      process.exit(1);
    }
  });

program
  .command('stop')
  .description('Stop a running agent')
  .requiredOption('-i, --id <agentId>', 'Agent ID to stop')
  .action(async (options) => {
    try {
      const launchManager = LaunchManager.getInstance();
      await launchManager.stopAgent(options.id);
      logger.info(`Agent ${options.id} stopped successfully`);
    } catch (error) {
      logger.error('Failed to stop agent:', error);
      process.exit(1);
    }
  });

// AutoScaler commands
program
  .command('scale')
  .description('Configure auto-scaling settings')
  .option('-m, --min-agents <min>', 'Minimum number of agents', '1')
  .option('-M, --max-agents <max>', 'Maximum number of agents', '10')
  .option('-u, --scale-up <threshold>', 'Scale up threshold', '0.8')
  .option('-d, --scale-down <threshold>', 'Scale down threshold', '0.2')
  .option('-c, --cooldown <period>', 'Cooldown period in milliseconds', '300000')
  .option('-w, --window <window>', 'Metrics window in milliseconds', '60000')
  .action(async (options) => {
    try {
      const autoScaler = AutoScaler.getInstance({
        minAgents: parseInt(options.minAgents),
        maxAgents: parseInt(options.maxAgents),
        scaleUpThreshold: parseFloat(options.scaleUp),
        scaleDownThreshold: parseFloat(options.scaleDown),
        cooldownPeriod: parseInt(options.cooldown),
        metricsWindow: parseInt(options.window),
        telemetryEnabled: true
      });
      await autoScaler.initialize();
      logger.info('Auto-scaling configured successfully');
    } catch (error) {
      logger.error('Failed to configure auto-scaling:', error);
      process.exit(1);
    }
  });

// Blueprint commands
program
  .command('create-blueprint')
  .description('Create a new deployment blueprint')
  .requiredOption('-n, --name <name>', 'Blueprint name')
  .requiredOption('-d, --description <description>', 'Blueprint description')
  .requiredOption('-s, --strategy <strategyId>', 'Strategy ID')
  .requiredOption('-m, --market <market>', 'Market to trade')
  .requiredOption('-c, --capital <capital>', 'Initial capital', parseFloat)
  .option('-t, --trust-throttle', 'Enable trust throttling', true)
  .option('-r, --max-retries <retries>', 'Maximum retry attempts', '3')
  .option('-D, --retry-delay <delay>', 'Retry delay in milliseconds', '5000')
  .action(async (options) => {
    try {
      const blueprintBuilder = BlueprintBuilder.getInstance();
      const blueprintId = await blueprintBuilder.createBlueprint({
        name: options.name,
        description: options.description,
        strategyId: options.strategy,
        market: options.market,
        capital: options.capital,
        trustThrottle: options.trustThrottle,
        maxRetries: parseInt(options.maxRetries),
        retryDelay: parseInt(options.retryDelay),
        telemetryEnabled: true,
        scaling: {
          minAgents: 1,
          maxAgents: 10,
          scaleUpThreshold: 0.8,
          scaleDownThreshold: 0.2,
          cooldownPeriod: 300000,
          metricsWindow: 60000
        }
      });
      logger.info(`Blueprint created successfully with ID: ${blueprintId}`);
    } catch (error) {
      logger.error('Failed to create blueprint:', error);
      process.exit(1);
    }
  });

program
  .command('activate-blueprint')
  .description('Activate a deployment blueprint')
  .requiredOption('-i, --id <blueprintId>', 'Blueprint ID to activate')
  .action(async (options) => {
    try {
      const blueprintBuilder = BlueprintBuilder.getInstance();
      await blueprintBuilder.activateBlueprint(options.id);
      logger.info(`Blueprint ${options.id} activated successfully`);
    } catch (error) {
      logger.error('Failed to activate blueprint:', error);
      process.exit(1);
    }
  });

program
  .command('deactivate-blueprint')
  .description('Deactivate a deployment blueprint')
  .requiredOption('-i, --id <blueprintId>', 'Blueprint ID to deactivate')
  .action(async (options) => {
    try {
      const blueprintBuilder = BlueprintBuilder.getInstance();
      await blueprintBuilder.deactivateBlueprint(options.id);
      logger.info(`Blueprint ${options.id} deactivated successfully`);
    } catch (error) {
      logger.error('Failed to deactivate blueprint:', error);
      process.exit(1);
    }
  });

program
  .command('list-blueprints')
  .description('List all deployment blueprints')
  .action(async () => {
    try {
      const blueprintBuilder = BlueprintBuilder.getInstance();
      const blueprints = blueprintBuilder.getAllBlueprints();
      console.table(blueprints.map(bp => ({
        id: bp.id,
        name: bp.config.name,
        strategy: bp.config.strategyId,
        market: bp.config.market,
        status: bp.status,
        activeAgents: bp.activeAgents.length
      })));
    } catch (error) {
      logger.error('Failed to list blueprints:', error);
      process.exit(1);
    }
  });

program.parse(process.argv); 