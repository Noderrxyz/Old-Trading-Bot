import { Command } from 'commander';
import { FeedGraphEngine } from '../telemetry/feed_graph/FeedGraphEngine.js';
import { FeedSource } from '../types/FeedSource.js';
import logger from '../utils/logger.js';
import chalk from 'chalk';

interface CliOptions {
  interval: string;
}

const program = new Command();

program
  .name('feeds-monitor')
  .description('Monitor feed status and performance')
  .version('1.0.0');

program
  .command('watch')
  .description('Watch feed status in real-time')
  .option('-i, --interval <ms>', 'Update interval in milliseconds', '1000')
  .action((options: CliOptions) => {
    const engine = FeedGraphEngine.getInstance();
    const interval = parseInt(options.interval);

    console.clear();
    console.log(chalk.bold('Feed Status Monitor'));
    console.log(chalk.gray('Press Ctrl+C to exit\n'));

    const updateDisplay = () => {
      const graph = engine.generateGraph();
      console.clear();
      console.log(chalk.bold('Feed Status Monitor'));
      console.log(chalk.gray('Press Ctrl+C to exit\n'));

      // Display header
      console.log(
        chalk.bold(
          'Symbol'.padEnd(10) +
          'Source'.padEnd(15) +
          'Latency'.padEnd(10) +
          'Status'.padEnd(15) +
          'Score'
        )
      );
      console.log('-'.repeat(60));

      // Display feed status
      graph.nodes
        .filter(node => node.type === 'source')
        .forEach(node => {
          const latency = node.metadata.latencyMs || 0;
          const latencyStr = latency < 1000 
            ? `${latency}ms` 
            : `${(latency / 1000).toFixed(1)}s`;
          
          const status = node.metadata.quarantined 
            ? chalk.red('❌ QUARANTINED') 
            : chalk.green('✅ ACTIVE');
          
          const score = node.metadata.score || 0;
          const scoreColor = score > 0.9 
            ? chalk.green 
            : score > 0.7 
              ? chalk.yellow 
              : chalk.red;
          
          console.log(
            'ETH/USD'.padEnd(10) +
            node.id.padEnd(15) +
            latencyStr.padEnd(10) +
            status.padEnd(15) +
            scoreColor(score.toFixed(2))
          );
        });

      // Display summary
      console.log('\n' + chalk.gray('-'.repeat(60)));
      console.log(
        chalk.bold('Summary:') +
        ` Total Feeds: ${graph.metadata.totalNodes}` +
        ` | Quarantined: ${graph.metadata.quarantinedCount}` +
        ` | Avg Latency: ${(graph.metadata.averageLatency / 1000).toFixed(1)}s`
      );
    };

    // Initial display
    updateDisplay();

    // Update at specified interval
    const updateInterval = setInterval(updateDisplay, interval);

    // Handle cleanup on exit
    process.on('SIGINT', () => {
      clearInterval(updateInterval);
      console.log('\n' + chalk.yellow('Monitoring stopped'));
      process.exit(0);
    });
  });

program.parse(process.argv); 