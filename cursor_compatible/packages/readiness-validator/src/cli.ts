#!/usr/bin/env node

/**
 * Readiness Validator CLI
 * 
 * Comprehensive pre-launch validation for Noderr Protocol
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { table } from 'table';
import * as dotenv from 'dotenv';
import { StartupCheck } from './checks/startup-check';
import { MessageBusCheck } from './checks/message-bus-check';
import { SimulationLoop } from './checks/simulation-loop';
import { LogTest } from './checks/log-test';
import { DashboardCheck } from './checks/dashboard-check';
import { ValidationResult, CheckType } from './types';

// Load environment variables
dotenv.config();

const program = new Command();

program
  .name('noderr-validate')
  .description('Noderr Protocol Readiness Validator')
  .version('1.0.0');

program
  .command('startup')
  .description('Check if all modules register successfully')
  .action(async () => {
    await runCheck(CheckType.STARTUP);
  });

program
  .command('messagebus')
  .description('Validate message bus performance and routing')
  .action(async () => {
    await runCheck(CheckType.MESSAGE_BUS);
  });

program
  .command('simulation')
  .description('Run trading simulation loop')
  .option('-d, --duration <minutes>', 'Simulation duration in minutes', '60')
  .action(async (options) => {
    await runCheck(CheckType.SIMULATION, options);
  });

program
  .command('logs')
  .description('Test logging infrastructure')
  .action(async () => {
    await runCheck(CheckType.LOGS);
  });

program
  .command('dashboard')
  .description('Verify dashboard connectivity and templates')
  .action(async () => {
    await runCheck(CheckType.DASHBOARD);
  });

program
  .command('all')
  .description('Run all validation checks')
  .option('--stop-on-failure', 'Stop if any check fails', false)
  .action(async (options) => {
    await runAllChecks(options.stopOnFailure);
  });

// Parse command line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

/**
 * Run a single check
 */
async function runCheck(type: CheckType, options?: any): Promise<ValidationResult> {
  const spinner = ora();
  let check: any;
  
  switch (type) {
    case CheckType.STARTUP:
      check = new StartupCheck();
      break;
    case CheckType.MESSAGE_BUS:
      check = new MessageBusCheck();
      break;
    case CheckType.SIMULATION:
      check = new SimulationLoop(options?.duration || 60);
      break;
    case CheckType.LOGS:
      check = new LogTest();
      break;
    case CheckType.DASHBOARD:
      check = new DashboardCheck();
      break;
    default:
      throw new Error(`Unknown check type: ${type}`);
  }
  
  spinner.start(chalk.blue(`Running ${type} check...`));
  
  try {
    const result = await check.run();
    
    if (result.success) {
      spinner.succeed(chalk.green(`${type} check passed`));
    } else {
      spinner.fail(chalk.red(`${type} check failed`));
    }
    
    // Display details
    if (result.details.length > 0) {
      console.log('\nDetails:');
      result.details.forEach(detail => {
        const icon = detail.success ? chalk.green('✓') : chalk.red('✗');
        console.log(`  ${icon} ${detail.message}`);
      });
    }
    
    // Display metrics if available
    if (result.metrics && Object.keys(result.metrics).length > 0) {
      console.log('\nMetrics:');
      const metricsTable = Object.entries(result.metrics).map(([key, value]) => [
        chalk.cyan(key),
        typeof value === 'number' ? value.toFixed(2) : value
      ]);
      console.log(table(metricsTable, {
        border: {
          topBody: '─',
          topJoin: '┬',
          topLeft: '┌',
          topRight: '┐',
          bottomBody: '─',
          bottomJoin: '┴',
          bottomLeft: '└',
          bottomRight: '┘',
          bodyLeft: '│',
          bodyRight: '│',
          bodyJoin: '│',
          joinBody: '─',
          joinLeft: '├',
          joinRight: '┤',
          joinJoin: '┼'
        }
      }));
    }
    
    return result;
  } catch (error) {
    spinner.fail(chalk.red(`${type} check error: ${error}`));
    return {
      success: false,
      checkType: type,
      timestamp: Date.now(),
      details: [{
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`
      }]
    };
  }
}

/**
 * Run all checks
 */
async function runAllChecks(stopOnFailure: boolean): Promise<void> {
  console.log(chalk.bold.blue('\n🚀 Noderr Protocol Readiness Validation\n'));
  
  const checks = [
    CheckType.STARTUP,
    CheckType.MESSAGE_BUS,
    CheckType.LOGS,
    CheckType.DASHBOARD,
    CheckType.SIMULATION
  ];
  
  const results: ValidationResult[] = [];
  let allPassed = true;
  
  for (const checkType of checks) {
    const result = await runCheck(checkType);
    results.push(result);
    
    if (!result.success) {
      allPassed = false;
      if (stopOnFailure) {
        console.log(chalk.red('\n❌ Validation stopped due to failure'));
        break;
      }
    }
    
    console.log(''); // Add spacing between checks
  }
  
  // Summary
  console.log(chalk.bold('\n📊 Validation Summary\n'));
  
  const summaryData = results.map(result => [
    result.checkType,
    result.success ? chalk.green('PASSED') : chalk.red('FAILED'),
    result.details.filter(d => d.success).length + '/' + result.details.length
  ]);
  
  summaryData.unshift(['Check', 'Status', 'Details']);
  
  console.log(table(summaryData, {
    border: {
      topBody: '═',
      topJoin: '╤',
      topLeft: '╔',
      topRight: '╗',
      bottomBody: '═',
      bottomJoin: '╧',
      bottomLeft: '╚',
      bottomRight: '╝',
      bodyLeft: '║',
      bodyRight: '║',
      bodyJoin: '│',
      joinBody: '─',
      joinLeft: '╟',
      joinRight: '╢',
      joinJoin: '┼'
    }
  }));
  
  if (allPassed) {
    console.log(chalk.bold.green('\n✅ All checks passed! System is ready for launch.\n'));
    process.exit(0);
  } else {
    console.log(chalk.bold.red('\n❌ Some checks failed. Please review and fix issues before launch.\n'));
    process.exit(1);
  }
} 