import { Command } from 'commander';
import { QuarantineManager } from '../feeds/quarantine/QuarantineManager.js';
import { ValidatorNode } from '../feeds/validator/ValidatorNode.js';
import logger from '../utils/logger.js';

const program = new Command();

program
  .name('validator-cli')
  .description('Monitor and manage feed validators')
  .version('1.0.0');

program
  .command('status')
  .description('Show current validator status')
  .action(() => {
    const quarantineManager = QuarantineManager.getInstance();
    const status = quarantineManager.getQuarantineStatus();

    console.log('\nFeed Validator Status');
    console.log('=====================');
    console.log('Source     | Latency  | Score   | Status');
    console.log('-----------|----------|---------|---------');

    status.forEach(({ source, isQuarantined, metrics }) => {
      const latency = (metrics.latencyMs / 1000).toFixed(1) + 's';
      const score = metrics.score.toFixed(2);
      const status = isQuarantined ? '❌ QUARANTINED' : '✅';
      
      console.log(
        `${source.padEnd(11)}| ${latency.padStart(8)} | ${score.padStart(7)} | ${status}`
      );
    });
  });

program
  .command('register')
  .description('Register a new feed validator')
  .option('-s, --source <source>', 'Feed source (e.g., uniswap_v3, binance)')
  .option('-t, --threshold <ms>', 'Quarantine threshold in milliseconds', '3000')
  .option('-h, --history <size>', 'Latency history size', '100')
  .action((options) => {
    try {
      const quarantineManager = QuarantineManager.getInstance();
      const validator = new ValidatorNode(options.source, {
        quarantineThresholdMs: parseInt(options.threshold),
        maxHistorySize: parseInt(options.history)
      });

      quarantineManager.registerValidator(options.source, validator);
      logger.info(`Registered validator for ${options.source}`);
    } catch (error) {
      logger.error('Error registering validator:', error);
      process.exit(1);
    }
  });

program
  .command('quarantine')
  .description('Get quarantine status for a specific feed')
  .option('-s, --source <source>', 'Feed source to check')
  .action((options) => {
    const quarantineManager = QuarantineManager.getInstance();
    const isQuarantined = quarantineManager.isQuarantined(options.source);
    
    console.log(`\nQuarantine Status for ${options.source}`);
    console.log('==========================');
    console.log(`Status: ${isQuarantined ? '❌ QUARANTINED' : '✅ ACTIVE'}`);
  });

program.parse(process.argv); 